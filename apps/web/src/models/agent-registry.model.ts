import { proxy } from "valtio";
import { genConfig } from "react-nice-avatar";
import { BUILTIN_AGENTS, DEFAULT_AGENT_ID, getAgentById, normalizeAgentId } from "@/lib/builtins";
import assistantIdentityModel from "@/models/assistant-identity.model";
import { agentApi } from "@/lib/agent-api";
import { onUserStorageScopeChange, readUserJsonStorage, writeUserJsonStorage } from "@/lib/browser-storage";
import { PROGRESSIVE_API_SKILL_NAME } from "@/lib/core-skills";
import type { AgentProfile } from "@/lib/agent-profile.types";
import type { AgentInfo } from "@/lib/types";
import {
	normalizePersistedAgentOverrides,
	normalizePersistedAgentWorkspaces,
	normalizePersistedCustomAgents,
	normalizePersistedSessionAgents,
} from "./agent-registry-persistence";

const STORAGE_KEY = "internshannon-session-agents";
const OVERRIDES_KEY = "internshannon-agent-overrides";
const CUSTOM_AGENTS_KEY = "internshannon-custom-agents";
const WORKSPACES_KEY = "internshannon-agent-workspaces";
const HIDDEN_KERNEL_AGENT_IDS = new Set(["default", "asset"]);

type AgentOverride = Partial<
	Pick<
		AgentProfile,
		| "defaultModel"
		| "defaultPermissionMode"
		| "systemPrompt"
		| "defaultSkills"
		| "sessionOptions"
		| "defaultKnowledgeBases"
		| "scheduledTasks"
	>
>;

interface MarketState {
	items: AgentProfile[];
	total: number;
	page: number;
	pageSize: number;
	loading: boolean;
	search: string;
	tags: string[];
}

interface AgentRegistryState {
	revision: number;
	/** Maps sessionId to agentId. */
	sessionAgents: Record<string, string>;
	/** User-created agents. */
	customAgents: AgentProfile[];
	/** Server-side agents loaded from backend registry. */
	serverAgents: AgentProfile[];
	/** Builtin/server agent overrides. */
	agentOverrides: Record<string, AgentOverride>;
	/** Default agent workspace paths. */
	agentWorkspaces: Record<string, string>;
	/** Marketplace pagination state */
	market: MarketState;
}

function loadOverrides(): Record<string, AgentOverride> {
	try {
		return normalizePersistedAgentOverrides(readUserJsonStorage<unknown>(OVERRIDES_KEY, {}));
	} catch {
		return {};
	}
}

function loadCustomAgents(): AgentProfile[] {
	try {
		return normalizePersistedCustomAgents(readUserJsonStorage<unknown>(CUSTOM_AGENTS_KEY, []));
	} catch {
		return [];
	}
}

function loadWorkspaces(): Record<string, string> {
	try {
		return normalizePersistedAgentWorkspaces(readUserJsonStorage<unknown>(WORKSPACES_KEY, {}));
	} catch {
		return {};
	}
}

function loadSessionAgents(): Record<string, string> {
	try {
		return normalizePersistedSessionAgents(readUserJsonStorage<unknown>(STORAGE_KEY, {}));
	} catch {
		return {};
	}
}

function persistCustomAgents() {
	writeUserJsonStorage(CUSTOM_AGENTS_KEY, state.customAgents);
}

function persistWorkspaces() {
	writeUserJsonStorage(WORKSPACES_KEY, state.agentWorkspaces);
}

const state = proxy<AgentRegistryState>({
	revision: 0,
	sessionAgents: loadSessionAgents(),
	customAgents: loadCustomAgents(),
	serverAgents: [],
	agentOverrides: loadOverrides(),
	agentWorkspaces: loadWorkspaces(),
	market: {
		items: [],
		total: 0,
		page: 1,
		pageSize: 20,
		loading: false,
		search: "",
		tags: [],
	},
});

function persistSessionAgents() {
	writeUserJsonStorage(STORAGE_KEY, state.sessionAgents);
}

function bumpRevision() {
	state.revision += 1;
}

function normalizeSessionAgentId(agentId?: string | null): string | null {
	return normalizeAgentId(agentId);
}

/** Convert a backend agent record to AgentProfile for UI use */
function serverAgentToAgentProfile(p: AgentInfo): AgentProfile {
	return {
		id: p.id,
		name: p.name,
		description: p.description,
		avatar: genConfig(p.id || p.name) as AgentProfile["avatar"],
		systemPrompt: "",
		builtin: false,
		hidden: HIDDEN_KERNEL_AGENT_IDS.has(p.id),
		tags: p.tags ?? [],
	};
}

/** Apply stored overrides and workspace on top of an agent profile. */
function applyOverrides(agent: AgentProfile): AgentProfile {
	const ov = state.agentOverrides[agent.id];
	const workspace = state.agentWorkspaces[agent.id];
	const merged = {
		...agent,
		...ov,
		defaultWorkspace: workspace || agent.defaultWorkspace,
	};
	if (!merged.builtin) return merged;
	const skills = new Set([PROGRESSIVE_API_SKILL_NAME, ...(merged.defaultSkills ?? [])]);
	const withSkills: AgentProfile = {
		...merged,
		defaultSkills: Array.from(skills),
	};
	// 默认智能助手:平台全局配置的名称/描述覆盖内置默认(头像 URL 因类型不同,在展示层处理)。
	// 空字段不覆盖,保持回退到内置默认(InternShannon名 / 内置描述)。
	if (agent.id !== DEFAULT_AGENT_ID) return withSkills;
	const configuredName = assistantIdentityModel.effectiveName();
	const configuredDescription = assistantIdentityModel.effectiveDescription();
	return {
		...withSkills,
		name: configuredName || withSkills.name,
		description: configuredDescription || withSkills.description,
	};
}

const actions = {
	resolveSessionAgentId(
		sessionId: string,
		explicitAgentId?: string | null,
	): string {
		const normalizedExplicit = normalizeSessionAgentId(explicitAgentId);
		if (normalizedExplicit) {
			return normalizedExplicit;
		}
		const mapped = normalizeSessionAgentId(state.sessionAgents[sessionId]);
		if (mapped) {
			return mapped;
		}
		return DEFAULT_AGENT_ID;
	},

	ensureSessionAgent(sessionId: string, explicitAgentId?: string | null) {
		const agentId = actions.resolveSessionAgentId(sessionId, explicitAgentId);
		if (state.sessionAgents[sessionId] !== agentId) {
			state.sessionAgents[sessionId] = agentId;
			persistSessionAgents();
			bumpRevision();
		}
		return agentId;
	},

	/** Assign an agent to a session. */
	setSessionAgent(sessionId: string, agentId: string) {
		state.sessionAgents[sessionId] = normalizeSessionAgentId(agentId) ?? DEFAULT_AGENT_ID;
		persistSessionAgents();
		bumpRevision();
	},

	/** Remove agent mapping when a session is deleted. */
	removeSessionAgent(sessionId: string) {
		delete state.sessionAgents[sessionId];
		persistSessionAgents();
		bumpRevision();
	},

	/** Get the agent for a session, falling back to default. */
	getSessionAgent(sessionId: string): AgentProfile {
		const agentId = actions.resolveSessionAgentId(sessionId);
		const base =
			getAgentById(agentId) ??
			state.customAgents.find((p) => p.id === agentId) ??
			state.serverAgents.find((p) => p.id === agentId) ??
			BUILTIN_AGENTS[0];
		return applyOverrides(base);
	},

	/** Get all available agents (builtin + server + custom) with overrides applied. */
	getAllAgents(): AgentProfile[] {
		const builtinIds = new Set(BUILTIN_AGENTS.map((p) => p.id));
		const customIds = new Set(state.customAgents.map((p) => p.id));
		return [
			...BUILTIN_AGENTS,
			...state.serverAgents.filter(
				(p) => !builtinIds.has(p.id) && !customIds.has(p.id),
			),
			...state.customAgents,
		]
			.map(applyOverrides)
			.filter((agent) => !agent.hidden);
	},

	/** Update agent defaults; builtin/server agents persist as overrides. */
	updateAgentDefaults(agentId: string, patch: Partial<AgentOverride>) {
		const custom = state.customAgents.find((p) => p.id === agentId);
		if (custom) {
			Object.assign(custom, patch);
			persistCustomAgents();
			bumpRevision();
		} else {
			state.agentOverrides[agentId] = {
				...state.agentOverrides[agentId],
				...patch,
			};
			writeUserJsonStorage(OVERRIDES_KEY, state.agentOverrides);
			bumpRevision();
		}
	},

	/** Add a custom user-created agent. */
	addCustomAgent(agent: AgentProfile) {
		state.customAgents.push({ ...agent, builtin: false });
		persistCustomAgents();
		bumpRevision();
	},

	/** Update a custom user-created agent. */
	updateCustomAgent(agentId: string, patch: Partial<AgentProfile>) {
		const idx = state.customAgents.findIndex((p) => p.id === agentId);
		if (idx >= 0) {
			Object.assign(state.customAgents[idx], patch);
			persistCustomAgents();
			bumpRevision();
		}
	},

	/** Delete a custom user-created agent. */
	deleteCustomAgent(agentId: string) {
		const idx = state.customAgents.findIndex((p) => p.id === agentId);
		if (idx >= 0) {
			state.customAgents.splice(idx, 1);
			persistCustomAgents();
			bumpRevision();
		}
	},

	/** Load server-side agents from the backend skill registry. */
	async loadServerAgents() {
		try {
			const agents: AgentInfo[] = (await agentApi.listAgents()) as AgentInfo[];
			state.serverAgents = agents.map(serverAgentToAgentProfile);
			bumpRevision();
		} catch {
			// Backend may not have agents configured; silently ignore.
		}
	},

	/** Fetch marketplace agents with pagination, search, and tag filtering. */
	async fetchMarketAgents(params?: {
		page?: number;
		search?: string;
		tags?: string[];
		reset?: boolean;
	}) {
		const page = params?.page ?? 1;
		const search = params?.search ?? state.market.search;
		const tags = params?.tags ?? state.market.tags;

		state.market.loading = true;
		state.market.search = search;
		state.market.tags = tags;

		try {
			const result = await agentApi.listMarketAgents({
				page,
				page_size: state.market.pageSize,
				search: search || undefined,
				tags: tags.length > 0 ? tags : undefined,
			});
			const items = result.items.map(serverAgentToAgentProfile);
			if (params?.reset || page === 1) {
				state.market.items = items;
			} else {
				// Append for infinite scroll, deduplicate by id
				const existingIds = new Set(state.market.items.map((p) => p.id));
				state.market.items.push(...items.filter((p) => !existingIds.has(p.id)));
			}
			state.market.total = result.total;
			state.market.page = result.page;
			bumpRevision();
		} catch {
			if (page === 1) {
				state.market.items = [];
				state.market.total = 0;
				state.market.page = 1;
				bumpRevision();
			}
		} finally {
			state.market.loading = false;
		}
	},

	/** Reset marketplace state */
	resetAgentMarket() {
		state.market.items = [];
		state.market.total = 0;
		state.market.page = 1;
		state.market.loading = false;
		state.market.search = "";
		state.market.tags = [];
	},

	/** Set default workspace for an agent. */
	setAgentWorkspace(agentId: string, workspacePath: string) {
		state.agentWorkspaces[agentId] = workspacePath;
		persistWorkspaces();
		bumpRevision();
	},

	/** Get default workspace for an agent. */
	getAgentWorkspace(agentId: string): string | undefined {
		return state.agentWorkspaces[agentId];
	},
};

onUserStorageScopeChange(() => {
	state.sessionAgents = loadSessionAgents();
	state.customAgents = loadCustomAgents();
	state.agentOverrides = loadOverrides();
	state.agentWorkspaces = loadWorkspaces();
	bumpRevision();
});

export default { state, ...actions };
