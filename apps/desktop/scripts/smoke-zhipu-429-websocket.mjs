#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { io } from "socket.io-client";
import { resolveDefaultDesktopResourcesDir } from "./desktop-bundle-paths.mjs";

const resourcesOrSidecarDir = path.resolve(process.argv[2] ?? resolveDefaultDesktopResourcesDir());
const sidecarDir = fs.existsSync(path.join(resourcesOrSidecarDir, "main.js"))
	? resourcesOrSidecarDir
	: path.join(resourcesOrSidecarDir, "sidecar");
const timeoutMs = 20_000;

if (!fs.existsSync(path.join(sidecarDir, "main.js"))) {
	throw new Error(`Could not find packaged sidecar main.js under ${resourcesOrSidecarDir}`);
}

function freePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") return reject(new Error("port allocation failed"));
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
	const value = text ? JSON.parse(text) : null;
	if (!response.ok) throw new Error(`${pathname} failed ${response.status}: ${text}`);
	return value?.data ?? value;
}

async function waitForHealth(port, child) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error(`sidecar exited ${child.exitCode}`);
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

function runRound(socket, sessionId, content) {
	const startedAt = Date.now();
	return new Promise((resolve, reject) => {
		const messages = [];
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error(`round timeout: ${JSON.stringify(messages.slice(-4))} requests=${requestCount} headers=${JSON.stringify(correlationHeaders)} logs=${JSON.stringify(logs.slice(-8000))}`));
		}, timeoutMs);
		const handler = (message) => {
			messages.push(message);
			if (message?.type !== "result") return;
			cleanup();
			resolve({ messages, result: message.data, elapsedMs: Date.now() - startedAt });
		};
		const cleanup = () => {
			clearTimeout(timer);
			socket.off("message", handler);
		};
		socket.on("message", handler);
		socket.emit("message", { sessionId, type: "user_message", content });
	});
}

const upstreamPort = await freePort();
let requestCount = 0;
let upstreamBusy = true;
const correlationHeaders = [];
const upstream = http.createServer(async (request, response) => {
	for await (const _chunk of request) {}
	requestCount += 1;
	correlationHeaders.push(request.headers["x-internshannon-session-id"]);
	if (upstreamBusy) {
		response.writeHead(429, { "content-type": "application/json" });
		response.end(JSON.stringify({ error: { code: 1305, message: "mock model busy" } }));
		return;
	}
	response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
	const chunk = {
		id: "chatcmpl-retry",
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model: "glm-429-smoke",
		choices: [{ index: 0, delta: { role: "assistant", content: "429 后同模型重试成功" }, finish_reason: null }],
	};
	response.write(`data: ${JSON.stringify(chunk)}\n\n`);
	response.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
	response.end("data: [DONE]\n\n");
});
await new Promise((resolve) => upstream.listen(upstreamPort, "127.0.0.1", resolve));

const sidecarPort = await freePort();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "internshannon-429-ws."));
const bundledNodeCandidates = [
	path.join(sidecarDir, "node/bin/node"),
	path.join(path.dirname(sidecarDir), "node/bin/node"),
];
const node = bundledNodeCandidates.find((candidate) => fs.existsSync(candidate)) ?? process.execPath;
const child = spawn(node, [path.join(sidecarDir, "main.js")], {
	cwd: sidecarDir,
	env: {
		...process.env,
		APP_PORT: String(sidecarPort),
		APP_HOST: "127.0.0.1",
		APP_MODE: "desktop",
		NODE_ENV: "production",
		INTERNSHANNON_DATA_DIR: dataDir,
		KERNEL_MODELS_CONFIG_TTL_MS: "0",
		KERNEL_ZHIPU_CODING_UPSTREAM_URL: `http://127.0.0.1:${upstreamPort}/chat/completions`,
	},
	stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (chunk) => (logs += chunk));
child.stderr.on("data", (chunk) => (logs += chunk));

let socket;
try {
	await waitForHealth(sidecarPort, child);
	const apiBase = `http://127.0.0.1:${sidecarPort}/api/v1`;
	await api(apiBase, "/config/categories/llm", {
		method: "PUT",
		body: JSON.stringify({
			defaultModel: "zhipu/glm-429-smoke",
			providers: [{
				name: "zhipu",
				apiKey: "mock-key",
				baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
				models: [{ id: "glm-429-smoke", name: "GLM 429 smoke", family: "openai", attachment: false, reasoning: false, toolCall: true, temperature: true }],
			}],
		}),
	});
	const created = await api(apiBase, "/kernel/sessions", {
		method: "POST",
		body: JSON.stringify({ agentId: "default", title: "429 smoke", model: "zhipu/glm-429-smoke", builtinSkills: false, planningMode: "disabled", maxStreamRetries: 0, continuationEnabled: false }),
	});
	const sessionId = created.session.sessionId;
	socket = io(`http://127.0.0.1:${sidecarPort}/ws/kernel`, { transports: ["websocket"], extraHeaders: { Origin: "tauri://localhost" }, reconnection: false });
	await waitSocket(socket, "connect", () => true);
	const subscribed = waitSocket(socket, "subscribed", (value) => value?.sessionId === sessionId);
	socket.emit("subscribe", { sessionId });
	await subscribed;
	const first = await runRound(socket, sessionId, "只回复测试");
	upstreamBusy = false;
	const second = await runRound(socket, sessionId, "同一会话、同一模型重试");
	const all = [...first.messages, ...second.messages];
	if (first.result?.stopReason !== "model_busy" || first.result?.retryable !== true) throw new Error(`first round mismatch: ${JSON.stringify(first.result)} headers=${JSON.stringify(correlationHeaders)} logs=${JSON.stringify(logs.slice(-6000))}`);
	if (second.result?.status !== "succeeded") throw new Error(`second round mismatch: ${JSON.stringify(second.result)}`);
	if (all.some((message) => /active operation/i.test(JSON.stringify(message)))) throw new Error("active operation collision remained");
	if (!logs.includes(`[kernel.model.busy] sessionId=${sessionId}`)) throw new Error(`runner did not consume the correlated busy signal: ${logs.slice(-6000)}`);
	if ((logs.match(/model=(?:provider-[^/]+|zhipu)\/glm-429-smoke/g) ?? []).length < 2) throw new Error(`same model was not retained across retry: ${logs.slice(-6000)}`);
	console.log(JSON.stringify({ ok: true, sessionId, firstElapsedMs: first.elapsedMs, secondElapsedMs: second.elapsedMs, first: first.result, second: second.result, requests: requestCount, sdkCorrelationHeaders: correlationHeaders, correlationMode: "unique-active-runner" }, null, 2));
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
