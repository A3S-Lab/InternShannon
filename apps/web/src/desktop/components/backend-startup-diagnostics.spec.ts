import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildBackendStartupDiagnosticClipboardText,
	buildBackendStartupFailureDetails,
	formatEmbeddedGatewayState,
	resolveBackendStartupRecoveryHint,
	type EmbeddedGatewayStatus,
} from "./backend-startup-diagnostics.ts";

function embedded(input: Partial<EmbeddedGatewayStatus> = {}): EmbeddedGatewayStatus {
	return {
		configuredUrl: "http://127.0.0.1:29653",
		host: "127.0.0.1",
		port: 29653,
		started: false,
		portInUse: false,
		...input,
	};
}

test("formats embedded gateway state for checking, ready, and starting states", () => {
	assert.equal(formatEmbeddedGatewayState(null), "checking");
	assert.equal(formatEmbeddedGatewayState(embedded({ started: true })), "started");
	assert.equal(formatEmbeddedGatewayState(embedded()), "starting");
});

test("surfaces port ownership directly in the embedded gateway state", () => {
	assert.equal(
		formatEmbeddedGatewayState(
			embedded({
				portInUse: true,
				portOwnerPid: 1234,
				portOwnerName: "node",
			}),
		),
		"port 29653 occupied (pid=1234 node)",
	);
});

test("builds startup diagnostics with health attempts, port owner, and startup log", () => {
	const details = buildBackendStartupFailureDetails({
		gateway: "http://127.0.0.1:29653",
		gatewayCandidates: ["http://127.0.0.1:29653", "http://localhost:29653"],
		healthError: "GET http://127.0.0.1:29653/api/v1/health -> ECONNREFUSED",
		healthAttempts: ["GET http://127.0.0.1:29653/api/v1/health -> ECONNREFUSED"],
		embeddedGateway: embedded({
			portInUse: true,
			portOwnerPid: 5678,
			portOwnerName: "ControlCenter",
			lastError: "port busy",
			lastErrorStage: "port-check",
			lastErrorCode: "gateway_port_occupied",
			diagnosticReportPath: "/tmp/internshannon_diagnostic.json",
			startupLog: [
				{
					at: "2026-06-04T00:00:00.000Z",
					stage: "port-check",
					message: "Port is busy",
				},
			],
		}),
	});

	assert.match(details, /gateway=http:\/\/127\.0\.0\.1:29653/);
	assert.match(details, /gateway_candidates=http:\/\/127\.0\.0\.1:29653,http:\/\/localhost:29653/);
	assert.match(details, /health_attempts=\nGET http:\/\/127\.0\.0\.1:29653\/api\/v1\/health -> ECONNREFUSED/);
	assert.match(details, /embedded_error_stage=port-check/);
	assert.match(details, /embedded_error_code=gateway_port_occupied/);
	assert.match(details, /port_owner_pid=5678/);
	assert.match(details, /port_owner_name=ControlCenter/);
	assert.match(details, /diagnostic_report=\/tmp\/internshannon_diagnostic\.json/);
	assert.match(details, /startup_log=\n2026-06-04T00:00:00\.000Z \[port-check\] Port is busy/);
});

test("copies full startup diagnostics instead of only the report path", () => {
	assert.equal(
		buildBackendStartupDiagnosticClipboardText({
			details: "embedded_error=port busy",
			diagnosticReportPath: "/tmp/internshannon_diagnostic.json",
		}),
		"embedded_error=port busy\ndiagnostic_report=/tmp/internshannon_diagnostic.json",
	);
	assert.equal(
		buildBackendStartupDiagnosticClipboardText({
			details: "embedded_error=port busy\ndiagnostic_report=/tmp/internshannon_diagnostic.json",
			diagnosticReportPath: "/tmp/internshannon_diagnostic.json",
		}),
		"embedded_error=port busy\ndiagnostic_report=/tmp/internshannon_diagnostic.json",
	);
	assert.equal(
		buildBackendStartupDiagnosticClipboardText({
			diagnosticReportPath: "/tmp/internshannon_diagnostic.json",
		}),
		"diagnostic_report=/tmp/internshannon_diagnostic.json",
	);
});

test("suggests a concrete recovery action when the backend port is occupied", () => {
	assert.deepEqual(
		resolveBackendStartupRecoveryHint({
			phase: "error",
			embeddedGateway: embedded({
				portInUse: true,
				portOwnerPid: 5678,
				portOwnerName: "ControlCenter",
			}),
		}),
		{
			title: "端口被占用",
			description:
				"端口 29653 正被 pid=5678 ControlCenter 占用。请停止该进程，或确认它是健康的书小安 sidecar 后再重新检测。",
		},
	);
});

test("suggests log-first recovery when the embedded gateway reports a startup error", () => {
	assert.deepEqual(
		resolveBackendStartupRecoveryHint({
			phase: "error",
			embeddedGateway: embedded({
				lastError: "sidecar exited",
				lastErrorStage: "spawn",
				lastErrorCode: "sidecar_exited",
			}),
		}),
		{
			title: "后端启动失败",
			description:
				"阶段 spawn（sidecar_exited）返回错误。请复制诊断信息后重试；如果持续失败，优先查看诊断报告里的 sidecar 日志。",
		},
	);
});

test("suggests waiting during checking and diagnostics when health probes time out", () => {
	assert.deepEqual(
		resolveBackendStartupRecoveryHint({
			phase: "checking",
			embeddedGateway: embedded(),
		}),
		{
			title: "正在等待本地后端",
			description: "首次启动会稍慢；如果超过一分钟仍未就绪，可先查看详情或重新检测。",
		},
	);
	assert.deepEqual(
		resolveBackendStartupRecoveryHint({
			phase: "error",
			embeddedGateway: embedded(),
			healthError: "connect ECONNREFUSED",
		}),
		{
			title: "本地 API 未响应",
			description: "健康检查仍未通过。请复制诊断信息，确认本地后端进程和端口状态后重试。",
		},
	);
});
