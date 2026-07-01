import type { SessionOptions } from '@a3s-lab/code';
import type { SessionRuntimeOverrides } from './session-runtime.types';

export const PLAN_READONLY_TOOL_BLOCK_REASON =
    '当前为先看方案模式，只允许读取、浏览和搜索；请切换到默认模式或自动执行后再修改文件或运行命令。';

const READONLY_PERMISSION_TOOLS = [
    'read',
    'read_file',
    'ls',
    'list',
    'glob',
    'grep',
    'find',
    'search',
    'web_search',
    'Read',
    'List',
    'LS',
    'Glob',
    'Grep',
    'Search',
    'WebSearch',
    'TodoRead',
    'NotebookRead',
];

export function permissionPolicyForMode(permissionMode?: string, hitlEnabled = true): SessionOptions['permissionPolicy'] {
    if (permissionMode === 'auto' || permissionMode === 'plan') {
        return { defaultDecision: 'allow' };
    }
    if (!hitlEnabled) {
        return undefined;
    }
    return {
        allow: [...READONLY_PERMISSION_TOOLS],
        defaultDecision: 'ask',
    };
}

export function confirmationPolicyForMode(
    permissionMode?: string,
    hitlEnabled = true,
): SessionOptions['confirmationPolicy'] {
    if (permissionMode === 'auto' || permissionMode === 'plan' || !hitlEnabled) {
        return undefined;
    }
    return {
        enabled: true,
        defaultTimeoutMs: 60_000,
        timeoutAction: 'reject',
        yoloLanes: ['query'],
    };
}

export function planningModeForRuntime(overrides: SessionRuntimeOverrides): string | undefined {
    if (overrides.permissionMode === 'plan') return 'enabled';
    const planningMode = overrides.planningMode?.trim();
    if (planningMode && planningMode !== 'auto') return planningMode;
    return undefined;
}

export function toolNameFromHookEvent(event: Record<string, unknown> | null | undefined): string {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return '';

    const direct = stringValue(event.toolName) ?? stringValue(event.tool) ?? stringValue(event.name);
    if (direct) return direct;

    for (const key of ['tool', 'toolCall', 'toolUse', 'call']) {
        const value = event[key];
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const record = value as Record<string, unknown>;
        const nested = stringValue(record.toolName) ?? stringValue(record.name);
        if (nested) return nested;
    }

    return '';
}

export function planReadonlyToolBlockReason(event: Record<string, unknown>): string | null {
    const toolName = toolNameFromHookEvent(event);
    if (!toolName) return null;
    return isReadOnlyToolName(toolName) ? null : PLAN_READONLY_TOOL_BLOCK_REASON;
}

export function isReadOnlyToolName(toolName: string): boolean {
    const normalized = normalizeToolName(toolName);
    if (!normalized) return true;
    if (normalized === 'web_search' || normalized.includes('search')) return true;
    if (normalized.includes('read') || normalized.includes('list') || normalized.includes('ls')) return true;
    if (normalized.includes('grep') || normalized.includes('glob') || normalized.includes('find')) return true;
    if (normalized.includes('inspect') || normalized.includes('status')) return true;
    if (normalized.includes('get') || normalized.includes('fetch')) return true;
    if (normalized.includes('open')) return true;
    return false;
}

function normalizeToolName(value: unknown): string {
    return typeof value === 'string'
        ? value
              .trim()
              .toLowerCase()
              .replace(/\s+/g, '_')
        : '';
}

function stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
