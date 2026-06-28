export type EmbeddedGatewayStatus = {
	configuredUrl: string;
	host: string;
	port: number;
	started: boolean;
	lastError?: string | null;
	lastErrorStage?: string | null;
	lastErrorCode?: string | null;
	diagnosticReportPath?: string | null;
	portInUse: boolean;
	portOwnerPid?: number | null;
	portOwnerName?: string | null;
	startupLog?: Array<{
		at: string;
		stage: string;
		message: string;
	}>;
};

export function formatEmbeddedGatewayState(
	embeddedGateway: EmbeddedGatewayStatus | null | undefined,
): string {
	if (!embeddedGateway) return "checking";
	if (embeddedGateway.started) return "started";
	if (embeddedGateway.portInUse) {
		const owner = [
			embeddedGateway.portOwnerPid ? `pid=${embeddedGateway.portOwnerPid}` : null,
			embeddedGateway.portOwnerName?.trim() || null,
		]
			.filter(Boolean)
			.join(" ");
		return `port ${embeddedGateway.port} occupied${owner ? ` (${owner})` : ""}`;
	}
	return "starting";
}

export function buildBackendStartupFailureDetails(input: {
	gateway: string;
	gatewayCandidates: readonly string[];
	embeddedGateway: EmbeddedGatewayStatus | null;
	healthError?: string;
	healthAttempts?: readonly string[];
}): string {
	const startupLog =
		input.embeddedGateway?.startupLog
			?.map((entry) => `${entry.at} [${entry.stage}] ${entry.message}`)
			.join("\n") || null;
	const lines = [
		`gateway=${input.gateway}`,
		`gateway_candidates=${input.gatewayCandidates.join(",")}`,
		input.healthError ? `health_error=${input.healthError}` : null,
		input.healthAttempts?.length
			? `health_attempts=\n${input.healthAttempts.join("\n")}`
			: null,
		input.embeddedGateway
			? `embedded_started=${input.embeddedGateway.started ? "true" : "false"}`
			: null,
		input.embeddedGateway?.lastError?.trim()
			? `embedded_error=${input.embeddedGateway.lastError.trim()}`
			: null,
		input.embeddedGateway?.lastErrorStage?.trim()
			? `embedded_error_stage=${input.embeddedGateway.lastErrorStage.trim()}`
			: null,
		input.embeddedGateway?.lastErrorCode?.trim()
			? `embedded_error_code=${input.embeddedGateway.lastErrorCode.trim()}`
			: null,
		input.embeddedGateway?.portInUse ? "port_in_use=true" : null,
		input.embeddedGateway?.portOwnerPid
			? `port_owner_pid=${input.embeddedGateway.portOwnerPid}`
			: null,
		input.embeddedGateway?.portOwnerName?.trim()
			? `port_owner_name=${input.embeddedGateway.portOwnerName.trim()}`
			: null,
		input.embeddedGateway?.diagnosticReportPath?.trim()
			? `diagnostic_report=${input.embeddedGateway.diagnosticReportPath.trim()}`
			: null,
		startupLog ? `startup_log=\n${startupLog}` : null,
	].filter(Boolean);

	return lines.join("\n");
}

export function buildBackendStartupDiagnosticClipboardText(input: {
	details?: string | null;
	diagnosticReportPath?: string | null;
}): string {
	const details = input.details?.trim();
	const diagnosticReportPath = input.diagnosticReportPath?.trim();

	if (details) {
		if (diagnosticReportPath && !details.includes(diagnosticReportPath)) {
			return `${details}\ndiagnostic_report=${diagnosticReportPath}`;
		}
		return details;
	}

	return diagnosticReportPath ? `diagnostic_report=${diagnosticReportPath}` : "";
}

export interface BackendStartupRecoveryHint {
	title: string;
	description: string;
}

function formatPortOwner(embeddedGateway: EmbeddedGatewayStatus): string {
	const owner = [
		embeddedGateway.portOwnerPid ? `pid=${embeddedGateway.portOwnerPid}` : null,
		embeddedGateway.portOwnerName?.trim() || null,
	]
		.filter(Boolean)
		.join(" ");
	return owner || "未知进程";
}

export function resolveBackendStartupRecoveryHint(input: {
	embeddedGateway?: EmbeddedGatewayStatus | null;
	healthError?: string | null;
	phase: "checking" | "error";
}): BackendStartupRecoveryHint {
	const embeddedGateway = input.embeddedGateway;
	if (embeddedGateway?.portInUse) {
		return {
			title: "端口被占用",
			description: `端口 ${embeddedGateway.port} 正被 ${formatPortOwner(embeddedGateway)} 占用。请停止该进程，或确认它是健康的InternShannon sidecar 后再重新检测。`,
		};
	}

	const stage = embeddedGateway?.lastErrorStage?.trim();
	const code = embeddedGateway?.lastErrorCode?.trim();
	const error = embeddedGateway?.lastError?.trim();
	if (error) {
		const stageLabel = stage ? `阶段 ${stage}` : "启动阶段";
		const codeLabel = code ? `（${code}）` : "";
		return {
			title: "后端启动失败",
			description: `${stageLabel}${codeLabel}返回错误。请复制诊断信息后重试；如果持续失败，优先查看诊断报告里的 sidecar 日志。`,
		};
	}

	if (input.phase === "checking") {
		return {
			title: "正在等待本地后端",
			description: "首次启动会稍慢；如果超过一分钟仍未就绪，可先查看详情或重新检测。",
		};
	}

	return {
		title: "本地 API 未响应",
		description: input.healthError?.trim()
			? "健康检查仍未通过。请复制诊断信息，确认本地后端进程和端口状态后重试。"
			: "本地后端没有在预期时间内就绪。请复制诊断信息后重试。",
	};
}
