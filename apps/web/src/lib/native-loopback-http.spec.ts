import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
	nativeLoopbackInvokeArgs,
	responseFromNativeLoopback,
} from "./native-loopback-http.ts";

test("wraps desktop PATCH requests in the Rust command request argument", () => {
	const body = JSON.stringify({ llm: { defaultModel: "智谱/glm-5" } });
	const args = nativeLoopbackInvokeArgs(
		"http://127.0.0.1:29653/api/v1/config",
		{
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body,
		},
	);

	assert.deepEqual(args, {
		request: {
			url: "http://127.0.0.1:29653/api/v1/config",
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body,
		},
	});
});

test("decodes native byte responses as UTF-8 JSON instead of comma-separated text", async () => {
	const payload = JSON.stringify({ code: 200, message: "AI 配置保存成功" });
	const response = responseFromNativeLoopback({
		status: 200,
		headers: { "content-type": "application/json; charset=utf-8" },
		body: Array.from(new TextEncoder().encode(payload)),
	});

	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), {
		code: 200,
		message: "AI 配置保存成功",
	});
});

test("keeps timeout handling in the shared native request adapter", () => {
	assert.deepEqual(
		nativeLoopbackInvokeArgs(
			"http://127.0.0.1:29653/api/v1/health",
			{ method: "GET" },
			2500,
		),
		{
			request: {
				url: "http://127.0.0.1:29653/api/v1/health",
				method: "GET",
				headers: {},
				body: null,
				timeoutMs: 2500,
			},
		},
	);
});

test("constructs native null-body responses without throwing", async () => {
	for (const status of [204, 205, 304]) {
		const response = responseFromNativeLoopback({
			status,
			headers: {},
			body: [],
		});

		assert.equal(response.status, status);
		assert.equal(await response.text(), "");
	}
});
