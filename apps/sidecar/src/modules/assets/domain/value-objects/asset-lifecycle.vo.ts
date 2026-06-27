export type AssetLifecycleState =
    | 'draft'
    | 'developing'
    | 'ready'
    | 'building'
    | 'packaged'
    | 'published'
    | 'deprecated'
    | 'archived';

export type AssetLifecycleTransition =
    | 'start_development'
    | 'mark_ready'
    | 'start_build'
    | 'build_succeeded'
    | 'build_failed'
    | 'publish'
    | 'unpublish'
    | 'deprecate'
    | 'archive'
    | 'restore';

export interface AssetLifecycleTransitionRule {
    event: AssetLifecycleTransition;
    from: AssetLifecycleState[];
    to: AssetLifecycleState;
    label: string;
    description: string;
    requiresReason?: boolean;
}

export interface AssetLifecycleHistoryEntry {
    id: string;
    event: AssetLifecycleTransition | 'initialize';
    from?: AssetLifecycleState;
    to: AssetLifecycleState;
    actorId?: string;
    reason?: string;
    source?: string;
    metadata?: Record<string, unknown>;
    at: string;
}

export interface AssetLifecycleMetadata {
    state: AssetLifecycleState;
    previousState?: AssetLifecycleState;
    updatedAt: string;
    updatedBy?: string;
    history: AssetLifecycleHistoryEntry[];
}

export const ASSET_LIFECYCLE_STATES: AssetLifecycleState[] = [
    'draft',
    'developing',
    'ready',
    'building',
    'packaged',
    'published',
    'deprecated',
    'archived',
];

export const ASSET_LIFECYCLE_STATE_LABELS: Record<AssetLifecycleState, string> = {
    draft: '草稿',
    developing: '开发中',
    ready: '待构建',
    building: '构建中',
    packaged: '已制品化',
    published: '已发布',
    deprecated: '已弃用',
    archived: '已归档',
};

export const ASSET_LIFECYCLE_TRANSITION_RULES: AssetLifecycleTransitionRule[] = [
    {
        event: 'start_development',
        from: ['draft', 'ready', 'packaged', 'published'],
        to: 'developing',
        label: '进入开发',
        description: '资产进入开发或返工状态；从 published 触发表示已发布版本不变，新改动回到开发态。',
    },
    {
        event: 'mark_ready',
        from: ['draft', 'developing'],
        to: 'ready',
        label: '标记待构建',
        description: '源码或配置已经准备好，可以进入构建。',
    },
    {
        event: 'start_build',
        from: ['ready', 'packaged'],
        to: 'building',
        label: '开始构建',
        description: '触发资产构建或打包流程。',
    },
    {
        event: 'build_succeeded',
        from: ['building', 'ready'],
        to: 'packaged',
        label: '构建成功',
        description: '构建产物已经生成并可作为 Package 使用。',
    },
    {
        event: 'build_failed',
        from: ['building'],
        to: 'developing',
        label: '构建失败',
        description: '构建失败，资产回到开发修复状态。',
        requiresReason: true,
    },
    {
        event: 'publish',
        // 'ready' 是 P6 加的:isolation=serving 的 agent 资产不构建用户镜像,
        // 直接从 git source 发布(同 workflow 资产路径)。container 路径仍走
        // packaged → published(plan-level 控制,catalog 不需要看 isolation)。
        from: ['ready', 'packaged'],
        to: 'published',
        label: '发布',
        description: '资产发布为可发现、可复用能力。',
    },
    {
        event: 'unpublish',
        from: ['published'],
        to: 'packaged',
        label: '取消发布',
        description: '资产保持制品可用，但不再作为已发布能力展示。',
        requiresReason: true,
    },
    {
        event: 'deprecate',
        from: ['packaged', 'published'],
        to: 'deprecated',
        label: '弃用',
        description: '资产仍可追溯，但不建议新任务继续采用。',
        requiresReason: true,
    },
    {
        event: 'archive',
        from: ['draft', 'developing', 'ready', 'building', 'packaged', 'published', 'deprecated'],
        to: 'archived',
        label: '归档',
        description: '资产冻结为归档状态。',
        requiresReason: true,
    },
    {
        event: 'restore',
        from: ['deprecated', 'archived'],
        to: 'developing',
        label: '恢复开发',
        description: '从弃用或归档状态恢复为开发状态。',
        requiresReason: true,
    },
];

export function isAssetLifecycleState(value: unknown): value is AssetLifecycleState {
    return typeof value === 'string' && ASSET_LIFECYCLE_STATES.includes(value as AssetLifecycleState);
}

/**
 * 资产类别在状态机里的差异：
 * - `agent`: 走完整 8 状态 + 全部 transition（构建 / 制品 / 发布闭环）。
 * - `workflow`: 没有构建阶段，跳过 `building` / `packaged`，
 *   publish 直接 `ready → published`、unpublish 回 `ready`。
 * - 其它类别（knowledge / memory / skill / mcp / code / tool）暂不使用本状态机，
 *   返回原始规则但调用方应在 UI 上隐藏。
 */
const WORKFLOW_EXCLUDED_EVENTS = new Set<AssetLifecycleTransition>([
    'start_build',
    'build_succeeded',
    'build_failed',
]);

const WORKFLOW_EXCLUDED_STATES = new Set<AssetLifecycleState>(['building', 'packaged']);

function withoutWorkflowExcludedStates(states: AssetLifecycleState[]): AssetLifecycleState[] {
    return states.filter(state => !WORKFLOW_EXCLUDED_STATES.has(state));
}

function workflowTransitionRules(): AssetLifecycleTransitionRule[] {
    return ASSET_LIFECYCLE_TRANSITION_RULES
        .filter(rule => !WORKFLOW_EXCLUDED_EVENTS.has(rule.event))
        .map((rule): AssetLifecycleTransitionRule => {
            switch (rule.event) {
                case 'publish':
                    // workflow 没有 packaged 阶段，发布从 ready 直接到 published
                    return { ...rule, from: ['ready' as AssetLifecycleState] };
                case 'unpublish':
                    // 对应回到 ready 而不是 packaged
                    return { ...rule, to: 'ready' as AssetLifecycleState };
                case 'start_development':
                case 'mark_ready':
                case 'deprecate':
                case 'archive':
                case 'restore':
                    // 去掉 from 里 workflow 不会出现的 packaged / building
                    return { ...rule, from: withoutWorkflowExcludedStates(rule.from) };
                default:
                    return rule;
            }
        })
        .filter(rule => rule.from.length > 0);
}

const WORKFLOW_LIFECYCLE_TRANSITION_RULES: AssetLifecycleTransitionRule[] = workflowTransitionRules();

export type AssetLifecycleCategory = 'agent' | 'workflow';

export function assetLifecycleTransitionRulesFor(
    category?: AssetLifecycleCategory | string,
): AssetLifecycleTransitionRule[] {
    if (category === 'workflow') return WORKFLOW_LIFECYCLE_TRANSITION_RULES;
    return ASSET_LIFECYCLE_TRANSITION_RULES;
}

export function assetLifecycleRule(
    state: AssetLifecycleState,
    event: AssetLifecycleTransition,
    category?: AssetLifecycleCategory | string,
): AssetLifecycleTransitionRule | undefined {
    return assetLifecycleTransitionRulesFor(category).find(rule => rule.event === event && rule.from.includes(state));
}

export function assetLifecycleAllowedTransitions(
    state: AssetLifecycleState,
    category?: AssetLifecycleCategory | string,
): AssetLifecycleTransitionRule[] {
    return assetLifecycleTransitionRulesFor(category).filter(rule => rule.from.includes(state));
}

/** workflow 不会进入 building / packaged，前端在状态徽章上也要按这个忽略。 */
export const WORKFLOW_UNREACHABLE_LIFECYCLE_STATES: readonly AssetLifecycleState[] = ['building', 'packaged'];
