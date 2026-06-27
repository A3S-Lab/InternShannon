/**
 * A3S Code Smoke Test — UTF-8 Safety Regression Test
 *
 * Tests that Chinese/multi-byte UTF-8 characters in tool arguments and
 * responses do NOT cause byte-boundary panics in string truncation.
 *
 * Usage (environment variables):
 *   MODEL_PROVIDER=openai MODEL_ID=kimi-k2.5 MODEL_API_KEY=xxx MODEL_BASE_URL=http://35.220.164.252:3888/v1/ DEFAULT_MODEL=openai/kimi-k2.5 npx tsx scripts/smoke-test-agent.ts
 *
 * Or from monorepo root with a config file path:
 *   A3S_CONFIG_HCL=.a3s/config.hcl npx tsx apps/safeclaw/scripts/smoke-test-agent.ts
 */

import { Agent } from "@a3s-lab/code";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

interface ModelConfig {
	defaultModel: string;
	provider: string;
	apiKey: string;
	baseUrl: string;
	modelId: string;
}

function buildInlineHcl(config: ModelConfig): string {
	return `
default_model = "${config.defaultModel}"

providers {
  name     = "${config.provider}"
  api_key  = "${config.apiKey}"
  base_url = "${config.baseUrl}"

  models {
    id   = "${config.modelId}"
    name = "${config.modelId}"
  }
}
`.trim();
}

async function main() {
	console.log("=".repeat(60));
	console.log("A3S Code — Smoke Test (UTF-8 Safety Regression)");
	console.log("=".repeat(60));
	console.log();

	// Build config from environment variables
	const modelConfig: ModelConfig = {
		defaultModel: process.env.DEFAULT_MODEL ?? "openai/kimi-k2.5",
		provider: process.env.MODEL_PROVIDER ?? "openai",
		apiKey: process.env.MODEL_API_KEY ?? "",
		baseUrl: process.env.MODEL_BASE_URL ?? "",
		modelId: process.env.MODEL_ID ?? "kimi-k2.5",
	};

	if (!modelConfig.apiKey || !modelConfig.baseUrl) {
		console.error(
			"Error: MODEL_API_KEY and MODEL_BASE_URL must be set via environment variables.\n" +
				"\nUsage:\n" +
				"  MODEL_PROVIDER=openai MODEL_ID=kimi-k2.5 \\\n" +
				"  MODEL_API_KEY=<key> MODEL_BASE_URL=http://... \\\n" +
				"  DEFAULT_MODEL=openai/kimi-k2.5 \\\n" +
				"  npx tsx scripts/smoke-test-agent.ts\n",
		);
		process.exit(1);
	}

	console.log(`Model:   ${modelConfig.defaultModel}`);
	console.log(`Provider: ${modelConfig.provider} (${modelConfig.baseUrl})`);
	console.log(`API Key:  ${modelConfig.apiKey.slice(0, 8)}...`);
	console.log();

	// Build inline HCL
	const inlineConfig = buildInlineHcl(modelConfig);

	// Create temp workspace
	const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "a3s-smoke-"));
	const workspace = path.join(tmpRoot, "workspace");
	fs.mkdirSync(workspace, { recursive: true });

	console.log(`Workspace: ${workspace}`);
	console.log();

	// Create agent
	console.log("Creating agent...");
	const agent = await Agent.create(inlineConfig);
	const session = agent.session(workspace, {
		permissionPolicy: { defaultDecision: "allow" },
	});
	console.log("✓ Agent created\n");

	// Test 1: Simple Chinese prompt (would trigger the old byte-slice panic)
	console.log("Test 1: Chinese character handling");
	console.log("  Prompt: 用户请求处理视频分析任务，涉及计费(费用:100元)");
	try {
		const result1 = await session.send(
			"用户请求处理视频分析任务，涉及计费(费用:100元)，请简要描述这个任务是什么？",
		);
		console.log("  ✓ No panic on Chinese input");
		console.log(`  Response: ${result1.text?.slice(0, 100) ?? "(no text)"}...`);
	} catch (err: any) {
		console.error(`  ✗ Failed: ${err.message}`);
		process.exit(1);
	}
	console.log();

	// Test 2: Simple Chinese text
	console.log("Test 2: Chinese text response");
	try {
		const result2 = await session.send(
			"请用一句话描述：今天天气很好，适合出去散步吗？请用中文回答。",
		);
		console.log("  ✓ Chinese response succeeded");
		console.log(`  Response: ${result2.text?.slice(0, 100) ?? "(no text)"}...`);
	} catch (err: any) {
		console.error(`  ✗ Failed: ${err.message}`);
		process.exit(1);
	}
	console.log();

	// Test 3: Long mixed content with Chinese chars that would require byte-level truncation
	console.log("Test 3: Long content truncation (byte 180 falls inside '费')");
	// This string, after whitespace joining, has byte 180 inside the '费' character
	const rawContent =
		"# Issue Summary\n\n# Issue Source\n- issue_id: 297936\n- org_id: 848\n- create_time: 2025-10-29 03:16:16\n- item_id: 11089\n\n## issue_name\n用户请求处理视频分析任务，涉及计费(费用:100元)\n";
	try {
		const result3 = await session.send(`请总结以下内容：\n\n${rawContent}`);
		console.log("  ✓ Long content with Chinese handled without panic");
		console.log(`  Response: ${result3.text?.slice(0, 100) ?? "(no text)"}...`);
	} catch (err: any) {
		console.error(`  ✗ Failed: ${err.message}`);
		process.exit(1);
	}
	console.log();

	// Cleanup
	session.close();
	fs.rmSync(tmpRoot, { recursive: true, force: true });

	console.log("=".repeat(60));
	console.log("✓ All smoke tests passed!");
	console.log("=".repeat(60));
}

main().catch((err) => {
	console.error("\nSmoke test failed:", err);
	process.exit(1);
});
