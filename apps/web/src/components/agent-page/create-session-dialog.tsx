import { AgentAvatar } from "@/components/agent-page/agent-avatar";
import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
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
	ChevronDown,
	Key,
	Link,
	Loader2,
	Search,
	Shield,
	Shuffle,
	Sparkles,
	Store,
	Trash2,
	User,
	UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useReactive } from "ahooks";
import NiceAvatar, { genConfig } from "react-nice-avatar";
import type { AvatarFullConfig } from "react-nice-avatar";
import { toast } from "sonner";
import { useSnapshot } from "valtio";

// =============================================================================
// Constants
// =============================================================================

/** All available filter tags — derived from builtin agent categories */
const ALL_TAGS = ["工程", "量化", "金融", "产品", "数据", "自定义"] as const;

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

function matchesAgentFilters(
	agent: AgentProfile,
	search: string,
	tags: Set<string>,
): boolean {
	const query = search.trim().toLowerCase();
	if (query) {
		const haystack = [
			agent.name,
			agent.description,
			...(agent.tags ?? []),
			agent.defaultModel ?? "",
		]
			.join(" ")
			.toLowerCase();
		if (!haystack.includes(query)) {
			return false;
		}
	}

	if (tags.size > 0) {
		const agentTags = new Set(agent.tags ?? []);
		if (![...tags].some((tag) => agentTags.has(tag))) {
			return false;
		}
	}

	return true;
}

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
	const agentRegistrySnap = useSnapshot(agentRegistryModel.state);
	const settingsSnap = useSnapshot(settingsModel.state);
	const agentLocked = defaults?.lockAgent === true;

	// Tab state
	const preferredSessionModel = getPreferredSessionModel();
	const state = useReactive({
		tab: agentLocked ? "custom" : defaults ? "custom" : "market",
		// 鈹€鈹€ Market tab state 鈹€鈹€
		marketSearch: "",
		activeTags: new Set<string>(),
		selectedAgentId: null as string | null,
		// 鈹€鈹€ Custom tab state 鈹€鈹€
		avatarConfig: defaults?.avatar || (genConfig() as AvatarFullConfig),
		sessionName: defaults?.sessionName || "",
		systemPrompt: defaults?.systemPrompt || "",
		model:
			normalizeModelInput(defaults?.model) || preferredSessionModel.modelId,
		permissionMode: defaults?.permissionMode || "default",
		cwd: "",
		advancedOpen: false,
		saveAsAgent: false,
		agentDescription: "",
		// 鈹€鈹€ Shared state 鈹€鈹€
		loading: false,
		error: null as string | null,
		workspaceFixing: false,
		// Model metadata
		modelOptions: [] as ModelOption[],
	});
	const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
	const allAgents = agentRegistryModel.getAllAgents();
	const marketItems = agentRegistrySnap.market
		.items as import("@/typings/agent-profile").AgentProfile[];

	const selectedMarketAgent = useMemo(
		() =>
			state.selectedAgentId
				? allAgents.find((p) => p.id === state.selectedAgentId) ||
				marketItems.find((p) => p.id === state.selectedAgentId) ||
				null
				: null,
		[state.selectedAgentId, allAgents, marketItems],
	);
	const lockedAgent = useMemo(
		() =>
			defaults?.agentId
				? allAgents.find((p) => p.id === defaults.agentId) ||
				marketItems.find((p) => p.id === defaults.agentId) ||
				null
				: null,
		[defaults?.agentId, allAgents, marketItems],
	);

	// Market data from backend (paginated)
	const featuredAgents = useMemo(() => {
		const marketIds = new Set(marketItems.map((agent) => agent.id));
		return allAgents
			.filter(
				(agent) =>
					agent.builtin &&
					!agent.hidden &&
					!marketIds.has(agent.id) &&
					matchesAgentFilters(agent, state.marketSearch, state.activeTags),
			)
			.sort((a, b) => a.name.localeCompare(b.name));
	}, [allAgents, marketItems, state.marketSearch, state.activeTags]);
	const marketTotal = agentRegistrySnap.market.total;
	const marketPage = agentRegistrySnap.market.page;
	const marketLoading = agentRegistrySnap.market.loading;
	const hasMore = marketItems.length < marketTotal;

	// Fetch market agents when dialog opens or filters change
	useEffect(() => {
		if (open && state.tab === "market") {
			agentRegistryModel.fetchMarketAgents({
				page: 1,
				search: state.marketSearch,
				tags: Array.from(state.activeTags),
				reset: true,
			});
		}
	}, [open, state.tab, state.marketSearch, state.activeTags]);

	// Debounced search
	const handleMarketSearch = useCallback(
		(value: string) => {
			state.marketSearch = value;
			if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
			searchTimerRef.current = setTimeout(() => {
				agentRegistryModel.fetchMarketAgents({
					page: 1,
					search: value,
					tags: Array.from(state.activeTags),
					reset: true,
				});
			}, 300);
		},
		[state.activeTags],
	);

	// Load next page
	const handleLoadMore = useCallback(() => {
		if (marketLoading || !hasMore) return;
		agentRegistryModel.fetchMarketAgents({
			page: marketPage + 1,
			search: state.marketSearch,
			tags: Array.from(state.activeTags),
		});
	}, [
		marketLoading,
		hasMore,
		marketPage,
		state.marketSearch,
		state.activeTags,
	]);

	useEffect(() => {
		if (!open) return;
		if (state.tab !== "market") return;
		let cancelled = false;
		if (!selectedMarketAgent) {
			void getEffectiveWorkspaceRoot().then((root) => {
				if (!cancelled) {
					state.cwd = joinWorkspacePath(root, "sessions", "...");
				}
			});
			return () => {
				cancelled = true;
			};
		}

		void (async () => {
			const resolved = await resolveAgentWorkingDirectory(selectedMarketAgent);
			if (!cancelled) {
				state.cwd = resolved || "";
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [open, state.tab, selectedMarketAgent]);

	// Scroll-based pagination
	const handleMarketScroll = useCallback(
		(e: React.UIEvent<HTMLDivElement>) => {
			const el = e.currentTarget;
			if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
				handleLoadMore();
			}
		},
		[handleLoadMore],
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
		: selectedMarketAgent;

	const syncModelCredentials = useCallback(
		(value: string) => {
			const selected = selectableModelSources.find((item) => item.id === value);
			const [providerFromId] =
				value.includes("/") && !selected
					? value.split("/", 2)
					: [selected?.provider || "", value];
			if (!providerFromId) return;
		},
		[selectableModelSources],
	);

	useEffect(() => {
		if (!defaults) return;

		const nextModel =
			normalizeModelInput(defaults.model) || preferredSessionModel.modelId;

		state.tab = "custom";
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

	const toggleTag = useCallback(
		(tag: string) => {
			const next = new Set(state.activeTags);
			if (next.has(tag)) next.delete(tag);
			else next.add(tag);
			state.activeTags = next;
			agentRegistryModel.fetchMarketAgents({
				page: 1,
				search: state.marketSearch,
				tags: Array.from(next),
				reset: true,
			});
		},
		[state.marketSearch],
	);

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

	const handleContinueWithAgentConfig = useCallback(async () => {
		if (!selectedMarketAgent) return;
		await populateCustomFormFromAgent(selectedMarketAgent);
		state.tab = "custom";
	}, [populateCustomFormFromAgent, selectedMarketAgent]);

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
		state.advancedOpen = false;
		state.saveAsAgent = false;
		state.agentDescription = "";
		state.error = null;
		state.selectedAgentId = null;
		state.marketSearch = "";
		state.activeTags = new Set();
		state.tab = "market";
		agentRegistryModel.resetAgentMarket();
	}, []);

	const handleCreate = async () => {
		const activeTab = agentLocked ? "custom" : state.tab;
		let agentId =
			defaults?.agentId ??
			(activeTab === "custom"
				? (state.selectedAgentId ?? undefined)
				: undefined);
		let finalModel = state.model;
		let finalPermMode = state.permissionMode;
		let finalPrompt = state.systemPrompt;
		let finalName = state.sessionName;
		let finalSkills: string[] | undefined;
		let finalSkillDirs: string[] | undefined;
		let targetAgent =
			(agentId
				? allAgents.find((p) => p.id === agentId) ||
				agentRegistryModel.state.market.items.find((p) => p.id === agentId)
				: null) ?? null;

		let finalCwd = "";
		try {
			if (activeTab === "market" && state.selectedAgentId) {
				targetAgent =
					allAgents.find((p) => p.id === state.selectedAgentId) ||
					agentRegistryModel.state.market.items.find(
						(p) => p.id === state.selectedAgentId,
					) ||
					null;
				if (targetAgent) {
					const { initializeAgentDefaults } = await import(
						"@/lib/workspace-utils"
					);
					await initializeAgentDefaults("pending", targetAgent.id);
					const resolvedCwd = await resolveAgentWorkingDirectory(targetAgent);
					agentId = targetAgent.id;
					finalModel = targetAgent.defaultModel || state.model;
					finalPermMode =
						targetAgent.defaultPermissionMode || state.permissionMode;
					finalName = finalName || targetAgent.name;
					if (resolvedCwd) {
						state.cwd = resolvedCwd;
					}
					finalSkills = targetAgent.defaultSkills;
					const runtimeConfig = await buildAgentRuntimeConfig(targetAgent);
					finalPrompt =
						runtimeConfig.systemPrompt ||
						targetAgent.systemPrompt ||
						state.systemPrompt;
					finalSkillDirs = runtimeConfig.skillDirs;
				}
			}

			if (!finalSkillDirs && targetAgent) {
				const { initializeAgentDefaults } = await import(
					"@/lib/workspace-utils"
				);
				await initializeAgentDefaults("pending", targetAgent.id);
				const resolvedCwd = await resolveAgentWorkingDirectory(targetAgent);
				if (resolvedCwd) {
					state.cwd = resolvedCwd;
				}
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

			if (
				activeTab === "custom" &&
				state.saveAsAgent &&
				state.sessionName.trim()
			) {
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

	const handleDeleteCustomAgent = (id: string, e: React.MouseEvent) => {
		e.stopPropagation();
		agentRegistryModel.deleteCustomAgent(id);
		if (state.selectedAgentId === id) state.selectedAgentId = null;
		toast.success("已删除自定义智能体");
	};

	const canCreate =
		(agentLocked ? "custom" : state.tab) === "market"
			? !!state.selectedAgentId
			: true;
	const primaryActionLabel =
		(agentLocked ? "custom" : state.tab) === "market" ? "直接创建" : "创建会话";

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

					<Tabs
						value={agentLocked ? "custom" : state.tab}
						onValueChange={(value) => {
							if (!agentLocked) {
								state.tab = value;
							}
						}}
						className="flex-1 flex flex-col min-h-0"
					>
						{!agentLocked ? (
							<div className="px-4 pt-3 shrink-0">
								{/* 步骤指示器 */}
								<div className="flex items-center gap-2 mb-3">
									<div className="flex items-center gap-1.5">
										<div
											className={`size-5 rounded-full flex items-center justify-center text-[10px] font-medium ${
												state.tab === "market"
													? "bg-primary text-primary-foreground"
													: "bg-primary/20 text-primary"
											}`}
										>
											1
										</div>
										<span
											className={`text-xs ${
												state.tab === "market"
													? "font-medium text-foreground"
													: "text-muted-foreground"
											}`}
										>
											选择智能体
										</span>
									</div>
									<div className="flex-1 h-px bg-border" />
									<div className="flex items-center gap-1.5">
										<div
											className={`size-5 rounded-full flex items-center justify-center text-[10px] font-medium ${
												state.tab === "custom"
													? "bg-primary text-primary-foreground"
													: "bg-muted text-muted-foreground"
											}`}
										>
											2
										</div>
										<span
											className={`text-xs ${
												state.tab === "custom"
													? "font-medium text-foreground"
													: "text-muted-foreground"
											}`}
										>
											配置会话
										</span>
									</div>
								</div>
								<TabsList className="w-full">
									<TabsTrigger value="market" className="flex-1 gap-1.5">
										<Store className="size-3.5" />
										{state.tab === "market" ? "选择智能体" : "智能体市场"}
									</TabsTrigger>
									<TabsTrigger value="custom" className="flex-1 gap-1.5">
										<UserPlus className="size-3.5" />
										{state.tab === "custom" ? "配置会话" : "自定义"}
									</TabsTrigger>
								</TabsList>
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

						{/* ===== Tab: Market ===== */}
						<TabsContent
							value="market"
							className="flex-1 flex flex-col min-h-0 mt-0"
						>
							{/* Search + tag filters */}
							<div className="px-4 pt-3 pb-2 space-y-2.5 shrink-0">
								<div className="relative">
									<Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
									<Input
										placeholder="搜索智能体名称、描述或标签..."
										value={state.marketSearch}
										onChange={(e) => handleMarketSearch(e.target.value)}
										className="pl-8 h-9"
									/>
								</div>
								<div className="flex items-center gap-1.5 flex-wrap">
									{ALL_TAGS.map((tag) => (
										<button
											key={tag}
											type="button"
											className={cn(
												"rounded-full px-2.5 py-0.5 text-[11px] font-medium border transition-colors",
												state.activeTags.has(tag)
													? "bg-primary text-white border-primary"
													: "bg-transparent text-muted-foreground border-border hover:border-foreground/20 hover:text-foreground",
											)}
											onClick={() => toggleTag(tag)}
										>
											{tag}
										</button>
									))}
									{state.activeTags.size > 0 && (
										<button
											type="button"
											className="text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors ml-1"
											onClick={() => {
												state.activeTags = new Set();
												agentRegistryModel.fetchMarketAgents({
													page: 1,
													search: state.marketSearch,
													tags: [],
													reset: true,
												});
											}}
										>
											清除筛选
										</button>
									)}
								</div>
							</div>

							{/* Agent grid */}
							<ScrollArea
								className="flex-1 min-h-0 px-4"
								onScrollCapture={handleMarketScroll}
							>
								{featuredAgents.length > 0 && (
									<div className="space-y-2 pb-3">
										<p className="text-[11px] font-medium text-muted-foreground">
											内置智能体
										</p>
										<div className="grid grid-cols-2 gap-2">
											{featuredAgents.map((agent) => {
												const cfg = genConfig(agent.avatar);
												const isSelected = state.selectedAgentId === agent.id;
												return (
													<button
														key={agent.id}
														type="button"
														className={cn(
															"relative flex items-start gap-2.5 rounded-lg border p-3 text-left transition-all hover:bg-accent/50",
															isSelected &&
															"border-primary bg-primary/5 ring-1 ring-primary/20",
														)}
														onClick={() => (state.selectedAgentId = agent.id)}
													>
														<AgentAvatar agent={agent} className="w-9 h-9 shrink-0" {...cfg} />
														<div className="flex-1 min-w-0">
															<div className="flex items-center gap-1.5">
																<span className="text-xs font-semibold truncate">
																	{agent.name}
																</span>
																<Badge
																	variant="secondary"
																	className="text-[9px] px-1 py-0 h-3.5 shrink-0"
																>
																	内置
																</Badge>
															</div>
															<p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5 leading-snug">
																{agent.description}
															</p>
															{agent.defaultModel ? (
																<p className="mt-1 text-[10px] font-medium text-emerald-700 truncate">
																	{agent.defaultModel}
																</p>
															) : null}
														</div>
													</button>
												);
											})}
										</div>
									</div>
								)}
								<div className="grid grid-cols-2 gap-2 pb-3">
									{marketItems.map((agent) => {
										const cfg = genConfig(agent.avatar);
										const isCustom = !agent.builtin && !agent.undeletable;
										const isSelected = state.selectedAgentId === agent.id;
										return (
											<button
												key={agent.id}
												type="button"
												className={cn(
													"relative flex items-start gap-2.5 rounded-lg border p-3 text-left transition-all hover:bg-accent/50",
													isSelected &&
													"border-primary bg-primary/5 ring-1 ring-primary/20",
												)}
												onClick={() => (state.selectedAgentId = agent.id)}
											>
												<AgentAvatar agent={agent} className="w-9 h-9 shrink-0" {...cfg} />
												<div className="flex-1 min-w-0">
													<div className="flex items-center gap-1.5">
														<span className="text-xs font-semibold truncate">
															{agent.name}
														</span>
														{isCustom && (
															<Badge
																variant="secondary"
																className="text-[9px] px-1 py-0 h-3.5 shrink-0"
															>
																自定义
															</Badge>
														)}
													</div>
													<p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5 leading-snug">
														{agent.description}
													</p>
													{agent.defaultModel ? (
														<p className="mt-1 text-[10px] font-medium text-emerald-700 truncate">
															{agent.defaultModel}
														</p>
													) : null}
													{agent.tags && agent.tags.length > 0 && (
														<div className="flex items-center gap-1 mt-1.5">
															{agent.tags.map((t) => (
																<span
																	key={t}
																	className="text-[9px] rounded-full bg-muted px-1.5 py-px text-muted-foreground"
																>
																	{t}
																</span>
															))}
														</div>
													)}
												</div>
												{isCustom && (
													<TooltipProvider delayDuration={300}>
														<Tooltip>
															<TooltipTrigger asChild>
																<button
																	type="button"
																	className="absolute top-2 right-2 p-0.5 rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
																	onClick={(e) =>
																		handleDeleteCustomAgent(agent.id, e)
																	}
																	aria-label="删除智能体"
																>
																	<Trash2 className="size-3" />
																</button>
															</TooltipTrigger>
															<TooltipContent side="top">
																<p>删除</p>
															</TooltipContent>
														</Tooltip>
													</TooltipProvider>
												)}
											</button>
										);
									})}
								</div>
								{/* Loading indicator */}
								{marketLoading && (
									<div className="flex items-center justify-center py-4 gap-2 text-muted-foreground">
										<Loader2 className="size-4 animate-spin" />
										<span className="text-xs">加载中...</span>
									</div>
								)}
								{/* Load more hint */}
								{!marketLoading && hasMore && marketItems.length > 0 && (
									<div className="flex justify-center py-3">
										<button
											type="button"
											className="text-xs text-muted-foreground hover:text-foreground transition-colors"
											onClick={handleLoadMore}
										>
											加载更多 ({marketItems.length}/{marketTotal})
										</button>
									</div>
								)}
								{/* Pagination info */}
								{!marketLoading && !hasMore && marketItems.length > 0 && (
									<div className="text-center py-2 text-[10px] text-muted-foreground/50">
										共 {marketTotal} 个智能体
									</div>
								)}
								{!marketLoading && marketItems.length === 0 && (
									<div className="py-5 text-center text-sm text-muted-foreground">
										{state.marketSearch || state.activeTags.size > 0
											? "未找到匹配的智能体"
											: "暂无可用智能体"}
									</div>
								)}
							</ScrollArea>
						</TabsContent>

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
														onClick={() => (state.tab = "market")}
													>
														重新选择
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
						{!agentLocked && state.tab === "market" && selectedMarketAgent ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => void handleContinueWithAgentConfig()}
								disabled={state.loading}
							>
								继续配置细节
							</Button>
						) : null}
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
