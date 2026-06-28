import { type AssistantSettings, configApi } from "@/lib/api/config";
import { proxy } from "valtio";

/**
 * 默认智能助手(default agent)的展示身份(名称 / 头像 URL / 描述)的前端缓存。
 * 与 platform-brand.model 同构:valtio proxy + localStorage 缓存 + seedFromBackend(读
 * configApi.getAssistant)。供单一解析点(agent-registry.model.applyOverrides + 浮窗)读取,
 * 任一字段为空时回退到内置默认(InternShannon名 / INTERNSHANNON_AVATAR / 内置描述)。
 *
 * 注意:/api/config/assistant 受 menu:system:settings(超管)把关,非超管拉取会 401;
 * 此处 seed 失败静默,模型保持空 → UI 回退内置默认,普通用户不受影响。
 */
const IDENTITY_CACHE_KEY = "assistant-identity:v1";

export interface AssistantIdentityState {
  name: string;
  avatar: string;
  description: string;
  hydrated: boolean;
  loading: boolean;
}

function normalizeText(value?: string | null) {
  return value?.trim() || "";
}

function normalizeAvatarUrl(value?: string | null) {
  const url = normalizeText(value);
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (/^(?:\/(?!\/)|\.{1,2}\/)/.test(url)) return url;
  if (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(url)) return url;
  return "";
}

function readCached(): Pick<AssistantIdentityState, "name" | "avatar" | "description"> {
  if (typeof window === "undefined") return { name: "", avatar: "", description: "" };
  try {
    const raw = window.localStorage.getItem(IDENTITY_CACHE_KEY);
    if (!raw) return { name: "", avatar: "", description: "" };
    const parsed = JSON.parse(raw) as Partial<AssistantSettings>;
    return {
      name: normalizeText(parsed.name),
      avatar: normalizeAvatarUrl(parsed.avatar),
      description: normalizeText(parsed.description),
    };
  } catch {
    return { name: "", avatar: "", description: "" };
  }
}

function writeCached(input: Pick<AssistantIdentityState, "name" | "avatar" | "description">) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(IDENTITY_CACHE_KEY, JSON.stringify(input));
  } catch {
    // Ignore storage quota/privacy failures; backend hydration is still authoritative.
  }
}

const cached = readCached();

const state = proxy<AssistantIdentityState>({
  name: cached.name,
  avatar: cached.avatar,
  description: cached.description,
  hydrated: false,
  loading: false,
});

function applySettings(input: AssistantSettings | null) {
  const next = input ?? {};
  state.name = normalizeText(next.name);
  state.avatar = normalizeAvatarUrl(next.avatar);
  state.description = normalizeText(next.description);
  state.hydrated = true;
  writeCached({ name: state.name, avatar: state.avatar, description: state.description });
}

async function seedFromBackend(): Promise<boolean> {
  if (state.loading) return false;
  state.loading = true;
  try {
    applySettings(await configApi.getAssistant());
    return true;
  } catch {
    // /api/config/assistant 需超管权限;非超管 401 时静默,保持回退内置默认。
    state.hydrated = true;
    return false;
  } finally {
    state.loading = false;
  }
}

/** 配置的名称(空 = 未配置,调用方回退内置默认)。 */
function effectiveName(): string {
  return normalizeText(state.name);
}

/** 配置的头像 URL(空 = 未配置,调用方回退内置 nice-avatar)。 */
function effectiveAvatarUrl(): string {
  return normalizeAvatarUrl(state.avatar);
}

/** 配置的描述(空 = 未配置,调用方回退内置默认)。 */
function effectiveDescription(): string {
  return normalizeText(state.description);
}

export default {
  state,
  applySettings,
  seedFromBackend,
  effectiveName,
  effectiveAvatarUrl,
  effectiveDescription,
};
