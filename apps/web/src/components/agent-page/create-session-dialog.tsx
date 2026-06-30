import { AgentAvatar } from "@/components/agent-page/agent-avatar";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { agentApi } from "@/lib/agent-api";
import { buildAgentRuntimeConfig } from "@/lib/agent-runtime-config";
import {
	createAgentSession,
	refreshSessionsInBackground,
} from "@/lib/session-bootstrap";
import { cn } from "@/lib/utils";
import {
	ensureWorkspaceReadiness,
	formatWorkspaceValidationError,
	getEffectiveWorkspaceRoot,
	prepareSessionWorkspacePath,
	resolveAgentWorkingDirectory,
} from "@/lib/workspace-utils";
import { joinWorkspacePath } from "@/lib/workspace-path";
import agentRegistryModel from "@/models/agent-registry.model";
import settingsModel, {
	getPreferredSessionModel,
	getAllModels,
} from "@/models/settings.model";
import type { AgentProfile } from "@/lib/agent-profile.types";
import {
	BookmarkPlus,
	Bot,
	Loader2,
	Shield,
	Shuffle,
	Sparkles,
	User,
	UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import { useReactive } from "ahooks";
import NiceAvatar, { genConfig } from "react-nice-avatar";
import type { AvatarFullConfig } from "react-nice-avatar";
import { toast } from "sonner";
import { useSnapshot } from "valtio";

// =============================================================================
// Types
// =============================================================================

interface CreateSessionDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated: (sessionId: string) => void;
	defaults?: {
		agentId: string;
		lockAgent?: boolean;
		sessionName: string;
		systemPrompt: string;
		avatar: AvatarFullConfig;
		model?: string;
		permissionMode?: string;
	};
}

type ModelOption = {
	id: string;
	name: string;
	provider?: string;
};

function formatModelOptionLabel(option: ModelOption): string {
	const name = option.name?.trim() || option.id;
	if (option.provider && name !== option.provider) {
		return `${name} · ${option.provider}`;
	}
	return name;
}

function normalizeModelInput(value?: string): string {
	const trimmed = value?.trim() || "";
	return trimmed;
}

// =============================================================================
// Dialog
// =============================================================================

export default function CreateSessionDialog({
	open,
	onOpenChange,
	onCreated,
	defaults,
}: CreateSessionDialogProps) {
	const agentRegistryRevision = useSnapshot(agentRegistryModel.state).revision;
	const settingsSnap = useSnapshot(settingsModel.state);
	const agentLocked = defaults?.lockAgent === true;

	// Tab state
	const preferredSessionModel = getPreferredSessionModel();
	const state = useReactive({
		// Local agent selection state.
		selectedAgentId: null as string | null,
		// 鈹€鈹€ Custom tab state 鈹€鈹€
		avatarConfig: defaults?.avatar || (genConfig() as AvatarFullConfig),
		sessionName: defaults?.sessionName || "",
		systemPrompt: defaults?.systemPrompt || "",
		model:
			normalizeModelInput(defaults?.model) || preferredSessionModel.modelId,
		permissionMode: defaults?.permissionMode || "default",
		cwd: "",
		saveAsAgent: false,
		agentDescription: "",
		// 鈹€鈹€ Shared state 鈹€鈹€
		loading: false,
		error: null as string | null,
		workspaceFixing: false,
		// Model metadata
		modelOptions: [] as ModelOption[],
	});
	useEffect(() => {
		if (!open) return;
		if (state.modelOptions.length === 0) {
			agentApi
				.listModelOptions()
				.then((r) => {
					if (Array.isArray(r)) state.modelOptions = r;
				})
				.catch(() => { });
		}
	}, [open, state.modelOptions.length]);

	const currentAvatarConfig = useMemo(
		() => genConfig(state.avatarConfig),
		[state.avatarConfig],
	);

	// 鈹€鈹€ Agent data 鈹€鈹€
	const allAgents = useMemo(() => agentRegistryModel.getAllAgents(), [agentRegistryRevision]);
	const localAgents = useMemo(
		() =>
			allAgents
				.filter((agent) => !agent.hidden)
				.sort((a, b) => a.name.localeCompare(b.name)),
		[allAgents],
	);
	const selectedLocalAgent = useMemo(
		() =>
			state.selectedAgentId
				? allAgents.find((p) => p.id === state.selectedAgentId) ?? null
				: null,
		[state.selectedAgentId, allAgents],
	);
	const lockedAgent = useMemo(
		() =>
			defaults?.agentId
				? allAgents.find((p) => p.id === defaults.agentId) ?? null
				: null,
		[defaults?.agentId, allAgents],
	);

	const availableModels = getAllModels();
	const fallbackModelOptions = useMemo(
		() =>
			availableModels.map((item) => ({
				id: item.model.id,
				name: item.model.name || item.model.id,
				provider: item.provider,
			})),
		[availableModels],
	);
	const selectableModelSources =
		state.modelOptions.length > 0 ? state.modelOptions : fallbackModelOptions;
	const selectableModelOptions = useMemo(
		() =>
			selectableModelSources.map((option) => ({
				...option,
				value: option.id,
			})),
		[selectableModelSources],
	);
	const selectedAgentForCustom = agentLocked
		? lockedAgent
		: selectedLocalAgent;

	const syncModelCredentials = useCallback(
		(value: string) => {
			const selected = selectableModelSources.find((item) => item.id === value);
			const providerFromId =
				value.includes("/") && !selected
					? value.slice(0, value.indexOf("/")).trim()
					: selected?.provider || "";
			if (!providerFromId) return;
		},
		[selectableModelSources],
	);

	useEffect(() => {
		if (!defaults) return;

		const nextModel =
			normalizeModelInput(defaults.model) || preferredSessionModel.modelId;

		state.avatarConfig = defaults.avatar;
		state.sessionName = defaults.sessionName;
		state.systemPrompt = defaults.systemPrompt;
		state.model = nextModel;
		state.permissionMode = defaults.permissionMode || "default";
		syncModelCredentials(nextModel);
	}, [defaults, preferredSessionModel.modelId, syncModelCredentials]);

	const handleModelChange = useCallback(
		(value: string) => {
			state.model = value;
			syncModelCredentials(value);
		},
		[syncModelCredentials],
	);

	// 鈹€鈹€ Actions 鈹€鈹€

	const handleRandomAvatar = useCallback(() => {
		state.avatarConfig = genConfig();
	}, []);

	const populateCustomFormFromAgent = useCallback(
		async (agent: AgentProfile) => {
			const runtimeConfig = await buildAgentRuntimeConfig(agent);
			const resolvedCwd = await resolveAgentWorkingDirectory(agent);
			const agentPrompt =
				runtimeConfig.systemPrompt || agent.systemPrompt || "";
			const agentModelId = normalizeModelInput(agent.defaultModel);

			state.sessionName = state.sessionName.trim()
				? state.sessionName
				: agent.name || state.sessionName;
			state.systemPrompt = agentPrompt;
			if (agentModelId) {
				state.model = agentModelId;
				syncModelCredentials(agentModelId);
			}
			state.permissionMode =
				agent.defaultPermissionMode || state.permissionMode || "default";
			if (resolvedCwd) {
				state.cwd = resolvedCwd;
			}
			state.error = null;
		},
		[state.permissionMode, syncModelCredentials],
	);

	const handleSelectLocalAgent = useCallback(
		async (agent: AgentProfile) => {
			state.selectedAgentId = state.selectedAgentId === agent.id ? null : agent.id;
			if (state.selectedAgentId) {
				await populateCustomFormFromAgent(agent);
			}
		},
		[populateCustomFormFromAgent],
	);

	const resetForm = useCallback(() => {
		const preferred = getPreferredSessionModel();
		state.avatarConfig = genConfig();
		state.sessionName = "";
		state.systemPrompt = "";
		state.model = preferred.modelId;
		state.permissionMode = "default";
		void getEffectiveWorkspaceRoot().then(
			(root) => (state.cwd = joinWorkspacePath(root, "sessions", "...")),
		);
		state.saveAsAgent = false;
		state.agentDescription = "";
		state.error = null;
		state.selectedAgentId = null;
	}, []);

	const handleCreate = async () => {
		let agentId =
			defaults?.agentId ??
			(state.selectedAgentId ?? undefined);
		let finalModel = state.model;
		let finalPermMode = state.permissionMode;
		let finalPrompt = state.systemPrompt;
		let finalName = state.sessionName;
		let finalSkills: string[] | undefined;
		let finalSkillDirs: string[] | undefined;
		let targetAgent =
			(agentId ? allAgents.find((p) => p.id === agentId) : null) ?? null;

		let finalCwd = "";
		try {
			if (!finalSkillDirs && targetAgent) {
				const { initializeAgentDefaults } = await import(
					"@/lib/workspace-utils"
				);
				await initializeAgentDefaults("pending", targetAgent.id);
				const resolvedCwd = await resolveAgentWorkingDirectory(targetAgent);
				if (resolvedCwd) {
					state.cwd = resolvedCwd;
				}
				finalModel = targetAgent.defaultModel || finalModel;
				finalPermMode = targetAgent.defaultPermissionMode || finalPermMode;
				finalName = finalName || targetAgent.name;
				const runtimeConfig = await buildAgentRuntimeConfig(targetAgent);
				finalPrompt =
					runtimeConfig.systemPrompt || finalPrompt || targetAgent.systemPrompt;
				finalSkillDirs = runtimeConfig.skillDirs;
				finalSkills = finalSkills ?? targetAgent.defaultSkills;
			}

			finalCwd =
				(targetAgent
					? await resolveAgentWorkingDirectory(targetAgent)
					: await prepareSessionWorkspacePath(null, "general")) ?? "";

			const readiness = await ensureWorkspaceReadiness(
				settingsSnap.agentDefaults.workspaceRoot,
			);
			if (readiness.needsRepair) {
				console.warn(
					"create_session_workspace_auto_repair_incomplete",
					readiness,
				);
				console.warn(formatWorkspaceValidationError(readiness));
			}
		} catch (preflightError) {
			console.warn(
				"create_session_preflight_failed_continuing",
				preflightError,
			);
		}

		state.loading = true;
		state.error = null;
		try {
			let sid: string;
			if (agentId) {
				const created = await createAgentSession({
					agentId,
					permissionMode: finalPermMode,
					cwd: finalCwd || undefined,
					model: finalModel || undefined,
					systemPrompt: finalPrompt || undefined,
					skills: finalSkills,
					skillDirs: finalSkillDirs,
				});
				sid = created.sessionId;
			} else {
				const result = await agentApi.createSession({
					permissionMode: finalPermMode,
					cwd: finalCwd || undefined,
					model: finalModel || undefined,
					systemPrompt: finalPrompt || undefined,
					skills: finalSkills,
					skillDirs: finalSkillDirs,
				});
				if (result.error || !result.session?.sessionId) {
					state.error = result.error || "创建会话失败";
					return;
				}
				sid = result.session?.sessionId;
			}
			if (finalName) {
				const { default: agentModel } = await import("@/models/agent.model");
				agentModel.setSessionName(sid, finalName);
				agentApi.updateSession(sid, { name: finalName }).catch(() => { });
			}

			if (agentId) {
				const { initializeAgentDefaults } = await import(
					"@/lib/workspace-utils"
				);
				await initializeAgentDefaults(sid, agentId);
			}

			if (state.saveAsAgent && state.sessionName.trim()) {
				const newAgentId = `custom-${Date.now()}`;
				agentRegistryModel.addCustomAgent({
					id: newAgentId,
					name: state.sessionName.trim(),
					description:
						state.agentDescription.trim() || state.sessionName.trim(),
					avatar: state.avatarConfig,
					systemPrompt: state.systemPrompt,
					defaultModel: state.model,
					defaultPermissionMode: state.permissionMode,
					tags: ["自定义"],
				});
				agentRegistryModel.setSessionAgent(sid, newAgentId);
				toast.success("智能体已保存", {
					description: state.sessionName.trim(),
				});
			}

			void refreshSessionsInBackground();
			onCreated(sid);
			onOpenChange(false);
			resetForm();
		} catch (error) {
			console.error("create_session_failed", {
				agentId,
				finalCwd,
				finalModel,
				finalPermMode,
				error,
			});
			state.error = error instanceof Error ? error.message : "无法连接到网关";
		} finally {
			state.loading = false;
		}
	};

	const handleRepairWorkspace = useCallback(async () => {
		state.workspaceFixing = true;
		try {
			const readiness = await ensureWorkspaceReadiness(
				settingsSnap.agentDefaults.workspaceRoot,
			);
			if (readiness.needsRepair) {
				throw new Error(formatWorkspaceValidationError(readiness));
			}
			state.error = null;
			toast.success("工作区已修复，可以重新创建会话");
		} catch (error) {
			state.error =
				error instanceof Error ? error.message : "修复工作区失败，请稍后重试";
		} finally {
			state.workspaceFixing = false;
		}
	}, [settingsSnap.agentDefaults.workspaceRoot]);

	const canCreate = true;
	const primaryActionLabel = "创建会话";

	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="sm:max-w-[620px] max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
					<DialogHeader className="px-4 pt-4 pb-0 shrink-0">
						<DialogTitle className="flex items-center gap-2 text-base">
							<Bot className="size-5" />
							新建 Agent 会话
						</DialogTitle>
					</DialogHeader>

					<Tabs value="custom" className="flex-1 flex flex-col min-h-0">
						{!agentLocked ? (
							<div className="px-4 pt-3 shrink-0 space-y-2">
								<div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
									<UserPlus className="size-3.5 text-primary" />
									本地智能体
								</div>
								<div className="flex gap-2 overflow-x-auto pb-1">
									{localAgents.map((agent) => {
										const isSelected = state.selectedAgentId === agent.id;
										return (
											<button
												key={agent.id}
												type="button"
												className={cn(
													"flex h-10 min-w-[128px] items-center gap-2 rounded-md border px-2 text-left transition-colors",
													isSelected
														? "border-primary bg-primary/5 text-primary"
														: "border-border bg-background hover:bg-muted",
												)}
												onClick={() => void handleSelectLocalAgent(agent)}
											>
												<AgentAvatar agent={agent} className="size-6 shrink-0" />
												<span className="min-w-0 truncate text-xs font-medium">{agent.name}</span>
											</button>
										);
									})}
								</div>
							</div>
						) : (
							<div className="px-4 pt-3 shrink-0">
								<div className="rounded-lg border bg-muted/30 px-3 py-2">
									<p className="text-xs font-medium text-foreground">
										当前智能体
									</p>
									<p className="mt-0.5 text-[11px] text-muted-foreground">
										正在为「
										{lockedAgent?.name ?? defaults?.sessionName ?? "当前智能体"}
										」创建新会话。若要切换智能体，请使用左侧列表顶部的新建会话按钮。
									</p>
								</div>
							</div>
						)}

						{/* ===== Tab: Custom ===== */}
						<TabsContent value="custom" className="flex-1 min-h-0 mt-0">
							<ScrollArea className="flex-1 min-h-0 px-4 pt-3">
								<div className="grid gap-3 pb-3">
									{selectedAgentForCustom ? (
										<div className="rounded-lg border bg-muted/30 px-3 py-2.5">
											<div className="flex items-start justify-between gap-3">
												<div className="min-w-0">
													<p className="text-xs font-medium text-foreground">
														当前智能体
													</p>
													<p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
														将基于「{selectedAgentForCustom.name}」的职责、
														技能和工作区创建会话。你仍可在下面覆盖模型和提示词等细节。
													</p>
												</div>
												{!agentLocked ? (
													<Button
														type="button"
														variant="outline"
														size="sm"
														className="h-7 shrink-0 text-[11px]"
														onClick={() => {
															state.selectedAgentId = null;
														}}
													>
														清除选择
													</Button>
												) : null}
											</div>
										</div>
									) : null}

									{/* Avatar + Name */}
									<div className="flex items-center gap-4">
										<div className="relative group">
											<NiceAvatar
												className="w-14 h-14 shrink-0"
												{...currentAvatarConfig}
											/>
											<button
												type="button"
												className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity"
												onClick={handleRandomAvatar}
												aria-label="随机头像"
											>
												<Shuffle className="size-4 text-white" />
											</button>
										</div>
										<div className="flex-1 space-y-1.5">
											<Label
												htmlFor="session-name"
												className="text-xs flex items-center gap-1"
											>
												<User className="size-3" />
												名称
											</Label>
											<Input
												id="session-name"
												placeholder="给会话起个名字"
												value={state.sessionName}
												onChange={(e) => (state.sessionName = e.target.value)}
												className="h-8"
											/>
										</div>
									</div>

									<div className="space-y-1.5">
										<Label
											htmlFor="system-prompt"
											className="text-xs flex items-center gap-1"
										>
											<Sparkles className="size-3" />
											系统提示词
										</Label>
										<Textarea
											id="system-prompt"
											placeholder="定义智能体的任务边界和行为方式..."
											value={state.systemPrompt}
											onChange={(e) => (state.systemPrompt = e.target.value)}
											className="min-h-[72px] resize-y text-xs"
										/>
									</div>

									<div className="grid gap-3 sm:grid-cols-2">
										<div className="space-y-1.5">
											<Label
												htmlFor="model"
												className="text-xs flex items-center gap-1"
											>
												<Bot className="size-3" />
												模型
											</Label>
											{selectableModelSources.length > 0 ||
												availableModels.length > 1 ? (
												<Select
													value={state.model}
													onValueChange={handleModelChange}
												>
													<SelectTrigger id="model" className="h-8 text-xs">
														<SelectValue placeholder="选择模型" />
													</SelectTrigger>
													<SelectContent>
														{selectableModelOptions.map((m) => (
															<SelectItem
																key={m.value}
																value={m.value}
																className="text-xs"
															>
																{formatModelOptionLabel(m)}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											) : (
												<Input
													id="model"
													placeholder="claude-sonnet-4-20250514"
													value={state.model}
													onChange={(e) => (state.model = e.target.value)}
													className="h-8 text-xs"
												/>
											)}
										</div>
										<div className="space-y-1.5">
											<Label
												htmlFor="perm-mode"
												className="text-xs flex items-center gap-1"
											>
												<Shield className="size-3" />
												权限模式
											</Label>
											<Select
												value={state.permissionMode}
												onValueChange={(v) => (state.permissionMode = v)}
											>
												<SelectTrigger id="perm-mode" className="h-8 text-xs">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="default" className="text-xs">
														默认模式
													</SelectItem>
													<SelectItem value="plan" className="text-xs">
														规划模式
													</SelectItem>
													<SelectItem
														value="auto"
														className="text-xs"
													>
														自动执行
													</SelectItem>
												</SelectContent>
											</Select>
										</div>
									</div>

									<div className="space-y-1.5">
										<Label className="text-xs">工作目录</Label>
										<div className="h-8 rounded-md border bg-muted/40 px-3 text-xs font-mono text-muted-foreground flex items-center">
											{state.cwd || "将在默认工作区中自动创建会话目录"}
										</div>
									</div>

									{/* Save as agent */}
									<div className="border-t pt-3">
										<label className="flex items-center gap-2 cursor-pointer group">
											<input
												type="checkbox"
												checked={state.saveAsAgent}
												onChange={(e) => (state.saveAsAgent = e.target.checked)}
												className="rounded border-muted-foreground/30"
											/>
											<BookmarkPlus className="size-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
											<span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
												保存为自定义智能体
											</span>
										</label>
										{state.saveAsAgent && (
											<div className="mt-2">
												<Input
													placeholder="智能体描述（可选）"
													value={state.agentDescription}
													onChange={(e) =>
														(state.agentDescription = e.target.value)
													}
													className="h-8 text-xs"
												/>
											</div>
										)}
									</div>

									{state.error && (
										<div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
											<div>{state.error}</div>
											{state.error.includes("工作区") ? (
												<div className="mt-2">
													<Button
														type="button"
														size="sm"
														variant="outline"
														className="h-7"
														onClick={() => void handleRepairWorkspace()}
														disabled={state.loading || state.workspaceFixing}
													>
														{state.workspaceFixing ? (
															<Loader2 className="mr-1 size-3 animate-spin" />
														) : null}
														修复工作区
													</Button>
												</div>
											) : null}
										</div>
									)}
								</div>
							</ScrollArea>
						</TabsContent>
					</Tabs>

					<DialogFooter className="px-4 py-3 border-t shrink-0">
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								onOpenChange(false);
								resetForm();
							}}
							disabled={state.loading}
						>
							取消
						</Button>
						<Button
							size="sm"
							onClick={handleCreate}
							disabled={state.loading || !canCreate}
						>
							{state.loading ? "创建中..." : primaryActionLabel}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
