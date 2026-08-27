#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { io } from "socket.io-client";
import { resolveDefaultDesktopResourcesDir } from "./desktop-bundle-paths.mjs";

const resourcesDir = path.resolve(
	process.argv[2] ?? resolveDefaultDesktopResourcesDir(),
);
const sidecarDir = fs.existsSync(path.join(resourcesDir, "main.js"))
	? resourcesDir
	: path.join(resourcesDir, "sidecar");
const timeoutMs = 45_000;
const explicitProvider = "explicit-provider";
const explicitModel = "explicit-model";
const explicitApiKey = "explicit-only-smoke-key";

if (!fs.existsSync(path.join(sidecarDir, "main.js"))) {
	throw new Error(
		`Could not find packaged sidecar main.js under ${resourcesDir}`,
	);
}

function freePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close(() => reject(new Error("port allocation failed")));
				return;
			}
			server.close(() => resolve(address.port));
		});
	});
}

async function api(base, pathname, init = {}) {
	const response = await fetch(`${base}${pathname}`, {
		...init,
		headers: {
			Origin: "tauri://localhost",
			...(init.body ? { "content-type": "application/json" } : {}),
			...init.headers,
		},
	});
	const text = await response.text();
	let value = text;
	try {
		value = text ? JSON.parse(text) : null;
	} catch {}
	return { response, text, value: value?.data ?? value };
}

async function waitForHealth(port, child) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			throw new Error(`sidecar exited ${child.exitCode}`);
		}
		try {
			const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
			if (response.ok) return;
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("sidecar health timeout");
}

function waitSocket(socket, event, predicate) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error(`${event} timeout`));
		}, timeoutMs);
		const handler = (value) => {
			if (!predicate(value)) return;
			cleanup();
			resolve(value);
		};
		const cleanup = () => {
			clearTimeout(timer);
			socket.off(event, handler);
		};
		socket.on(event, handler);
	});
}

function runRound(socket, sessionId) {
	return new Promise((resolve, reject) => {
		const messages = [];
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error(`round timeout: ${JSON.stringify(messages.slice(-4))}`));
		}, timeoutMs);
		const handler = (message) => {
			messages.push(message);
			if (message?.type !== "result") return;
			cleanup();
			resolve({ messages, result: message.data });
		};
		const cleanup = () => {
			clearTimeout(timer);
			socket.off("message", handler);
		};
		socket.on("message", handler);
		socket.emit("message", {
			sessionId,
			type: "user_message",
			content: "只回复：显式模型链路通过",
		});
	});
}

const upstreamPort = await freePort();
const upstreamRequests = [];
const upstream = http.createServer(async (request, response) => {
	const chunks = [];
	for await (const chunk of request) chunks.push(chunk);
	const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
	upstreamRequests.push({
		url: request.url,
		authorization: request.headers.authorization,
		model: body.model,
	});
	response.writeHead(200, {
		"cache-control": "no-cache",
		"content-type": "text/event-stream",
	});
	const chunk = {
		id: "chatcmpl-explicit-model",
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model: explicitModel,
		choices: [
			{
				index: 0,
				delta: { role: "assistant", content: "显式模型链路通过" },
				finish_reason: null,
			},
		],
	};
	response.write(`data: ${JSON.stringify(chunk)}\n\n`);
	response.write(
		`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
	);
	response.end("data: [DONE]\n\n");
});
await new Promise((resolve) =>
	upstream.listen(upstreamPort, "127.0.0.1", resolve),
);

const sidecarPort = await freePort();
const dataDir = fs.mkdtempSync(
	path.join(os.tmpdir(), "internshannon-no-auto-model."),
);
const bundledNode = [
	path.join(resourcesDir, "node", "bin", "node"),
	path.join(sidecarDir, "node", "bin", "node"),
	path.join(path.dirname(sidecarDir), "node", "bin", "node"),
].find((candidate) => fs.existsSync(candidate));
const logs = { value: "" };
const child = spawn(
	bundledNode ?? process.execPath,
	[path.join(sidecarDir, "main.js")],
	{
		cwd: sidecarDir,
		env: {
			...process.env,
			APP_PORT: String(sidecarPort),
			APP_HOST: "127.0.0.1",
			APP_MODE: "desktop",
			NODE_ENV: "production",
			INTERNSHANNON_DATA_DIR: dataDir,
			KERNEL_MODELS_CONFIG_TTL_MS: "0",
		},
		stdio: ["ignore", "pipe", "pipe"],
	},
);
child.stdout.on("data", (chunk) => {
	logs.value += chunk;
});
child.stderr.on("data", (chunk) => {
	logs.value += chunk;
});

let socket;
try {
	await waitForHealth(sidecarPort, child);
	const apiBase = `http://127.0.0.1:${sidecarPort}/api/v1`;
	const config = await api(apiBase, "/config/categories/llm", {
		method: "PUT",
		body: JSON.stringify({
			defaultModel: "missing-provider/missing-model",
			providers: [
				{
					name: "missing-provider",
					apiKey: "",
					models: [
						{
							id: "missing-model",
							name: "Missing model",
							family: "openai",
							attachment: false,
							reasoning: false,
							toolCall: true,
							temperature: true,
						},
					],
				},
				{
					name: explicitProvider,
					apiKey: explicitApiKey,
					baseUrl: `http://127.0.0.1:${upstreamPort}`,
					models: [
						{
							id: explicitModel,
							name: "Explicit model",
							family: "openai",
							attachment: false,
							reasoning: false,
							toolCall: true,
							temperature: true,
						},
					],
				},
			],
		}),
	});
	if (!config.response.ok) {
		throw new Error(`config failed ${config.response.status}: ${config.text}`);
	}

	const implicit = await api(apiBase, "/kernel/sessions", {
		method: "POST",
		body: JSON.stringify({
			agentId: "default",
			title: "No automatic model switch smoke",
			followDefaultModel: true,
			builtinSkills: false,
			planningMode: "disabled",
		}),
	});
	if (!implicit.response.ok) {
		throw new Error(
			`implicit session creation failed ${implicit.response.status}: ${implicit.text}`,
		);
	}
	const implicitSessionId = implicit.value?.session?.sessionId;
	if (!implicitSessionId) {
		throw new Error("implicit session did not return sessionId");
	}

	socket = io(`http://127.0.0.1:${sidecarPort}/ws/kernel`, {
		transports: ["websocket"],
		extraHeaders: { Origin: "tauri://localhost" },
		reconnection: false,
	});
	await waitSocket(socket, "connect", () => true);
	const implicitSubscribed = waitSocket(
		socket,
		"subscribed",
		(value) => value?.sessionId === implicitSessionId,
	);
	socket.emit("subscribe", { sessionId: implicitSessionId });
	await implicitSubscribed;
	const implicitErrorPromise = waitSocket(
		socket,
		"message",
		(message) =>
			message?.type === "error" &&
			/No valid API key configured for default model missing-provider\/missing-model/i.test(
				String(message.message ?? ""),
			),
	);
	socket.emit("message", {
		sessionId: implicitSessionId,
		type: "user_message",
		content: "本轮必须使用默认模型",
	});
	await implicitErrorPromise;
	if (upstreamRequests.length !== 0) {
		throw new Error("Credentialed alternate provider was called automatically");
	}
	socket.close();
	socket = undefined;

	const explicit = await api(apiBase, "/kernel/sessions", {
		method: "POST",
		body: JSON.stringify({
			agentId: "default",
			title: "Explicit model smoke",
			model: `${explicitProvider}/${explicitModel}`,
			followDefaultModel: false,
			builtinSkills: false,
			planningMode: "disabled",
			maxStreamRetries: 0,
			continuationEnabled: false,
		}),
	});
	if (!explicit.response.ok) {
		throw new Error(
			`explicit session failed ${explicit.response.status}: ${explicit.text}`,
		);
	}
	const sessionId = explicit.value?.session?.sessionId;
	if (!sessionId) throw new Error("explicit session did not return sessionId");

	socket = io(`http://127.0.0.1:${sidecarPort}/ws/kernel`, {
		transports: ["websocket"],
		extraHeaders: { Origin: "tauri://localhost" },
		reconnection: false,
	});
	await waitSocket(socket, "connect", () => true);
	const subscribed = waitSocket(
		socket,
		"subscribed",
		(value) => value?.sessionId === sessionId,
	);
	socket.emit("subscribe", { sessionId });
	await subscribed;
	const round = await runRound(socket, sessionId);
	if (round.result?.status !== "succeeded") {
		throw new Error(
			`explicit WebSocket round failed: ${JSON.stringify(round.result)}`,
		);
	}
	if (
		upstreamRequests.length < 1 ||
		upstreamRequests.some(
			(request) =>
				request.model !== explicitModel ||
				request.authorization !== `Bearer ${explicitApiKey}`,
		)
	) {
		throw new Error(
			`explicit provider request mismatch: ${JSON.stringify(upstreamRequests)}`,
		);
	}
	console.log(
		JSON.stringify(
			{
				ok: true,
				implicitDefaultRun: "rejected",
				automaticAlternateRequests: 0,
				explicitWebSocketModel: `${explicitProvider}/${explicitModel}`,
				explicitRequests: upstreamRequests.length,
			},
			null,
			2,
		),
	);
} catch (error) {
	throw new Error(
		`${error instanceof Error ? error.message : String(error)} logs=${JSON.stringify(logs.value.slice(-8_000))}`,
	);
} finally {
	socket?.close();
	if (child.exitCode === null) child.kill("SIGTERM");
	await Promise.race([
		new Promise((resolve) => child.once("exit", resolve)),
		new Promise((resolve) => setTimeout(resolve, 2_000)),
	]);
	upstream.closeAllConnections?.();
	await new Promise((resolve) => upstream.close(resolve));
	fs.rmSync(dataDir, { recursive: true, force: true });
}
