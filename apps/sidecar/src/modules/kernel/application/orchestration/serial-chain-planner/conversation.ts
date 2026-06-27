/**
 * Conversation-driven replan: parse a user reply into one of seven editing
 * intents and apply it to an existing chain.
 *
 * Ported from `serial_agent_chain/conversation.py` (rule-based parser branch
 * only). The original LLM-driven parser is kept as a future extension via the
 * optional `IntentParser` strategy on `ConversationReplanner`.
 */
import { ContractCompiler } from './contract-compiler';
import {
    ChainStatus,
    type Chain,
    type ChainChangeOperation,
    type ChainRevision,
    type ConversationIntent,
    type TaskRecord,
    type TaskView,
} from './schemas';
import { sha256Json } from './hashing';
import { LocalRepairer } from './repair/patch-search';
import { HardVerifier } from './verifier';
import { fallbackTaskViews } from './chain-planner';

const TASK_ID_RE = /\bt\s*(\d+)\b/gi;

const CN_NUMBER_MAP: Record<string, number> = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

export interface ChainEditIntent {
    intent: ConversationIntent;
    message: string;
    targetTaskCount: number | null;
    taskIds: string[];
    topic: string | null;
}

function taskIdFromNumber(value: string): string | null {
    const normalized = value.trim().toLowerCase().replace(/\s+/g, '');
    if (/^t\d+$/.test(normalized)) return `t${parseInt(normalized.slice(1), 10)}`;
    if (/^\d+$/.test(normalized)) return `t${parseInt(normalized, 10)}`;
    const number = CN_NUMBER_MAP[normalized];
    return number ? `t${number}` : null;
}

function extractTaskIds(message: string): string[] {
    const ids: string[] = [];
    for (const match of message.matchAll(TASK_ID_RE)) {
        ids.push(`t${parseInt(match[1]!, 10)}`);
    }
    const patterns = [
        /第([一二两三四五六七八九十\d]+)个(?:任务|节点)?/g,
        /(?:任务|节点)\s*([一二两三四五六七八九十\d]+)/g,
        /删掉\s*([一二两三四五六七八九十\d]+)/g,
        /删除\s*([一二两三四五六七八九十\d]+)/g,
    ];
    for (const pattern of patterns) {
        for (const match of message.matchAll(pattern)) {
            const id = taskIdFromNumber(match[1]!);
            if (id) ids.push(id);
        }
    }
    return Array.from(new Set(ids));
}

function extractTargetCount(message: string): number | null {
    const patterns = [
        /(?:压缩|缩短|精简|减少|控制|改成|变成|生成|拆成|扩展|增加|加到|调整到)\D{0,8}(\d{1,2})\s*(?:个|项)?(?:任务|节点)?/,
        /(\d{1,2})\s*(?:个|项)(?:任务|节点)/,
    ];
    for (const pattern of patterns) {
        const match = message.match(pattern);
        if (match) {
            const count = parseInt(match[1]!, 10);
            if (count >= 1 && count <= 20) return count;
        }
    }
    return null;
}

function extractTopic(message: string): string | null {
    const quoted = message.match(/[“"']([^”"']{2,40})[”"']/);
    if (quoted) return quoted[1]!.trim();
    const patterns = [
        /(?:增加|新增|加一个|加上|插入|补一个)([^，。；;\n]{2,40}?)(?:任务|节点|环节|步骤)/,
        /(?:需要|要)([^，。；;\n]{2,40}?)(?:任务|节点|环节|步骤)/,
    ];
    for (const pattern of patterns) {
        const match = message.match(pattern);
        if (match) {
            let topic = match[1]!.trim();
            topic = topic.replace(/^(一个|一项|个|项)/, '').trim();
            if (topic) return topic;
        }
    }
    return null;
}

export class RuleBasedIntentParser {
    parse(message: string, chain: Chain): ChainEditIntent {
        const text = message.trim();
        const taskIds = extractTaskIds(text);
        const targetCount = extractTargetCount(text);
        const topic = extractTopic(text);
        const currentCount = chain.records.length;

        const has = (...keywords: string[]) => keywords.some((kw) => text.includes(kw));
        const base = (intent: ConversationIntent, targetTaskCount: number | null): ChainEditIntent => ({
            intent,
            message: text,
            targetTaskCount,
            taskIds,
            topic,
        });

        if (has('重新生成', '重来', '换一版', '重新规划', '从头')) {
            return base('regenerate_chain', targetCount ?? currentCount);
        }
        if (has('太长', '过长', '精简', '压缩', '缩短', '减少')) {
            return base('shorten_chain', targetCount ?? Math.max(1, currentCount - 1));
        }
        if (has('太短', '过短', '详细', '拆细', '展开', '扩展', '增加步骤', '多几个')) {
            return base('lengthen_chain', targetCount ?? Math.min(20, currentCount + 1));
        }
        if (has('删除', '删掉', '去掉', '移除', '不要')) {
            return base('delete_task', Math.max(1, currentCount - 1));
        }
        if (has('增加', '新增', '加一个', '加上', '插入', '补一个')) {
            return base('insert_task', Math.min(20, currentCount + 1));
        }
        if (taskIds.length > 0 || has('改', '修改', '调整', '换成')) {
            return base('rewrite_task', currentCount);
        }
        return base('clarify_chain', currentCount);
    }
}

export interface ConversationReplannerResult {
    chain: Chain;
    revision: ChainRevision;
    changeSet: ChainChangeOperation[];
    dirtySpan: string[];
    lockedTasks: string[];
}

export interface ConversationReplannerOptions {
    parser?: RuleBasedIntentParser;
    compiler?: ContractCompiler;
    verifier?: HardVerifier;
}

export class ConversationReplanner {
    private readonly parser: RuleBasedIntentParser;
    private readonly compiler: ContractCompiler;
    private readonly verifier: HardVerifier;

    constructor(options: ConversationReplannerOptions = {}) {
        this.parser = options.parser ?? new RuleBasedIntentParser();
        this.compiler = options.compiler ?? new ContractCompiler();
        this.verifier = options.verifier ?? new HardVerifier();
    }

    apply(chain: Chain, message: string): ConversationReplannerResult {
        const intent = this.parser.parse(message, chain);
        const oldIds = chain.records.map((record) => record.task_id);
        const parentRevisionId = chain.current_revision_id;

        const { views, changeSet } = this.applyIntent(chain, intent);
        const normalized = normalizeTaskIds(views);
        const records = this.compileRecords(normalized);

        const next: Chain = {
            chain_id: chain.chain_id,
            version: chain.version + 1,
            status: ChainStatus.Draft,
            records,
            repair_trace: [...chain.repair_trace],
            expected_final_outputs: [...chain.expected_final_outputs],
            original_prompt: chain.original_prompt,
            current_revision_id: null,
            revision_counter: chain.revision_counter + 1,
            conversation_summary: appendSummary(chain.conversation_summary, intent),
        };

        const verified = this.verifyAndRepair(next);
        const revisionId = `rev_${String(verified.revision_counter).padStart(4, '0')}`;
        verified.current_revision_id = revisionId;

        const newIds = verified.records.map((record) => record.task_id);
        const dirtySpan = computeDirtySpan(oldIds, newIds, changeSet);
        const lockedTasks = newIds.filter((id) => !dirtySpan.includes(id));

        const revision: ChainRevision = {
            revision_id: revisionId,
            parent_revision_id: parentRevisionId,
            chain_id: verified.chain_id,
            version: verified.version,
            status: verified.status,
            intent: intent.intent,
            user_message: intent.message,
            change_set: changeSet,
            tasks: verified.records.map((record) => record.view),
            created_at: new Date().toISOString(),
            summary: revisionSummary(intent, changeSet),
        };

        return { chain: verified, revision, changeSet, dirtySpan, lockedTasks };
    }

    // ────────────────────────────────────────────────────────────────────
    // Intent application
    // ────────────────────────────────────────────────────────────────────

    private applyIntent(
        chain: Chain,
        intent: ChainEditIntent,
    ): { views: TaskView[]; changeSet: ChainChangeOperation[] } {
        const views = chain.records.map((record) => record.view);
        switch (intent.intent) {
            case 'shorten_chain':
                return this.shorten(views, intent);
            case 'lengthen_chain':
                return this.lengthen(views, intent);
            case 'insert_task':
                return this.insert(views, intent);
            case 'delete_task':
                return this.deleteTask(views, intent);
            case 'rewrite_task':
                return this.rewrite(views, intent);
            case 'regenerate_chain':
                return this.regenerate(chain, intent);
            case 'clarify_chain':
            default:
                return this.rewrite(views, intent);
        }
    }

    private shorten(
        views: TaskView[],
        intent: ChainEditIntent,
    ): { views: TaskView[]; changeSet: ChainChangeOperation[] } {
        const target = Math.max(1, Math.min(intent.targetTaskCount ?? views.length, views.length));
        const current = [...views];
        const changeSet: ChainChangeOperation[] = [];
        while (current.length > target) {
            const index = mergeIndex(current);
            const left = current[index]!;
            const right = current[index + 1]!;
            const merged: TaskView = {
                task_id: left.task_id,
                title: mergedTitle(left, right),
                description: `${left.description} 同时，${right.description}`,
                requirement: `${left.requirement}；并满足：${right.requirement}`,
            };
            current.splice(index, 2, merged);
            changeSet.push({
                op: 'merge_tasks',
                task_ids: [left.task_id, right.task_id],
                target_task_count: target,
                title: merged.title,
                description: merged.description,
                requirement: merged.requirement,
                message: intent.message,
            });
        }
        return { views: current, changeSet };
    }

    private lengthen(
        views: TaskView[],
        intent: ChainEditIntent,
    ): { views: TaskView[]; changeSet: ChainChangeOperation[] } {
        let target = Math.max(views.length + 1, intent.targetTaskCount ?? views.length + 1);
        target = Math.min(20, target);
        const current = [...views];
        const changeSet: ChainChangeOperation[] = [];
        while (current.length < target) {
            const index = splitIndex(current, intent);
            const source = current[index]!;
            const [first, second] = splitView(source);
            current.splice(index, 1, first, second);
            changeSet.push({
                op: 'split_task',
                task_ids: [source.task_id],
                target_task_count: target,
                title: second.title,
                description: second.description,
                requirement: second.requirement,
                message: intent.message,
            });
            if (current.length >= target) break;
        }
        return { views: current, changeSet };
    }

    private insert(
        views: TaskView[],
        intent: ChainEditIntent,
    ): { views: TaskView[]; changeSet: ChainChangeOperation[] } {
        const topic = intent.topic ?? topicFromMessage(intent.message) ?? '补充核查';
        let insertAt = Math.max(0, views.length - 1);
        if (intent.taskIds.length > 0) {
            const idx = views.findIndex((v) => v.task_id === intent.taskIds[0]);
            if (idx >= 0) insertAt = Math.min(idx + 1, views.length);
        }
        const newView = viewForTopic(topic);
        const next = [...views.slice(0, insertAt), newView, ...views.slice(insertAt)];
        const change: ChainChangeOperation = {
            op: 'insert_task',
            task_ids: intent.taskIds,
            title: newView.title,
            description: newView.description,
            requirement: newView.requirement,
            position: intent.taskIds.length > 0 ? `after:${intent.taskIds[0]}` : 'before:final',
            message: intent.message,
        };
        return { views: next, changeSet: [change] };
    }

    private deleteTask(
        views: TaskView[],
        intent: ChainEditIntent,
    ): { views: TaskView[]; changeSet: ChainChangeOperation[] } {
        if (views.length <= 1) {
            return {
                views,
                changeSet: [{ op: 'noop', task_ids: [], message: 'Cannot delete the only task.' }],
            };
        }
        const taskId = intent.taskIds[0];
        let index = taskId ? views.findIndex((v) => v.task_id === taskId) : -1;
        if (index < 0) index = views.length > 1 ? views.length - 2 : 0;
        const removed = views[index]!;
        const next = views.filter((_, i) => i !== index);
        return {
            views: next,
            changeSet: [
                {
                    op: 'delete_task',
                    task_ids: [removed.task_id],
                    target_task_count: next.length,
                    message: intent.message,
                },
            ],
        };
    }

    private rewrite(
        views: TaskView[],
        intent: ChainEditIntent,
    ): { views: TaskView[]; changeSet: ChainChangeOperation[] } {
        const taskId = intent.taskIds[0];
        let index = taskId ? views.findIndex((v) => v.task_id === taskId) : -1;
        if (index < 0) index = Math.max(0, views.length - 1);
        const current = [...views];
        const source = current[index]!;
        const topic = intent.topic ?? topicFromMessage(intent.message);

        let rewritten: TaskView;
        if (topic) {
            rewritten = {
                task_id: source.task_id,
                title: compactTitle(topic),
                description: `围绕${topic}调整当前任务内容，确保与用户最新反馈一致。`,
                requirement: `需落实用户反馈：${intent.message}；输出可被下游任务使用的结果。`,
            };
        } else {
            rewritten = {
                task_id: source.task_id,
                title: source.title,
                description: source.description,
                requirement: `${source.requirement}；同时需响应用户反馈：${intent.message}`,
            };
        }
        current[index] = rewritten;
        return {
            views: current,
            changeSet: [
                {
                    op: 'rewrite_task',
                    task_ids: [source.task_id],
                    title: rewritten.title,
                    description: rewritten.description,
                    requirement: rewritten.requirement,
                    message: intent.message,
                },
            ],
        };
    }

    private regenerate(
        chain: Chain,
        intent: ChainEditIntent,
    ): { views: TaskView[]; changeSet: ChainChangeOperation[] } {
        const target = intent.targetTaskCount ?? chain.records.length;
        const basePrompt = chain.original_prompt || intent.message;
        const prompt = intent.message ? `${basePrompt}。用户最新调整要求：${intent.message}` : basePrompt;
        const views = fallbackTaskViews(prompt, Math.max(1, Math.min(20, target)));
        return {
            views,
            changeSet: [
                {
                    op: 'regenerate_chain',
                    task_ids: [],
                    target_task_count: views.length,
                    message: intent.message,
                },
            ],
        };
    }

    // ────────────────────────────────────────────────────────────────────
    // Compile + verify
    // ────────────────────────────────────────────────────────────────────

    private compileRecords(views: TaskView[]): TaskRecord[] {
        const records: TaskRecord[] = [];
        const upstreamOutputs: string[] = [];
        for (const view of views) {
            const contract = this.compiler.compile(view, upstreamOutputs);
            const record: TaskRecord = {
                task_id: view.task_id,
                view,
                contract,
                metadata: {
                    version: 1,
                    view_hash: sha256Json(view),
                    contract_hash: sha256Json(contract),
                    locked: false,
                    created_by: 'planner',
                    last_modified_by: 'system',
                },
            };
            records.push(record);
            upstreamOutputs.push(...contract.outputs);
        }
        return records;
    }

    private verifyAndRepair(chain: Chain): Chain {
        const result = this.verifier.verify(chain);
        if (result.pass) {
            chain.status = ChainStatus.Verified;
            return chain;
        }
        const repairer = new LocalRepairer(this.verifier);
        const { chain: repaired, result: finalResult } = repairer.repair(chain);
        repaired.status = finalResult.pass ? ChainStatus.Verified : ChainStatus.NeedsRepair;
        return repaired;
    }
}

// ────────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────────

function normalizeTaskIds(views: TaskView[]): TaskView[] {
    return views.map((view, index) => ({ ...view, task_id: `t${index + 1}` }));
}

function appendSummary(existing: string, intent: ChainEditIntent): string {
    const line = `${intent.intent}: ${intent.message}`;
    const trimmed = existing.trim();
    if (!trimmed) return line;
    const lines = [...trimmed.split(/\r?\n/), line];
    return lines.slice(-8).join('\n');
}

function revisionSummary(intent: ChainEditIntent, changeSet: ChainChangeOperation[]): string {
    const ops = changeSet.map((change) => change.op).join(', ') || 'noop';
    return `${intent.intent}: ${ops}`;
}

function computeDirtySpan(
    oldIds: string[],
    newIds: string[],
    changeSet: ChainChangeOperation[],
): string[] {
    const changed = new Set<string>();
    for (const change of changeSet) {
        for (const id of change.task_ids) changed.add(id);
        if (change.task_id) changed.add(change.task_id);
    }
    if (changed.size === 0 || oldIds.length !== newIds.length) return newIds;
    const overlap = newIds.filter((id) => changed.has(id));
    return overlap.length > 0 ? overlap : newIds;
}

function mergeIndex(views: TaskView[]): number {
    if (views.length <= 2) return 0;
    return 1;
}

function splitIndex(views: TaskView[], intent: ChainEditIntent): number {
    if (intent.taskIds.length > 0) {
        const idx = views.findIndex((v) => v.task_id === intent.taskIds[0]);
        if (idx >= 0) return idx;
    }
    return Math.max(0, views.length - 2);
}

function splitView(view: TaskView): [TaskView, TaskView] {
    if (/差距|风险|分析/.test(view.title)) {
        const firstTitle = view.title.replace('差距分析', '证据整理').replace('分析', '证据整理');
        const secondTitle = /分析/.test(view.title) ? view.title : `${view.title}分析`;
        return [
            {
                task_id: view.task_id,
                title: compactTitle(firstTitle),
                description: `拆分自${view.title}，先整理支撑事实、依据和待核验信息。`,
                requirement: '需输出结构化证据摘要，标明缺失项、冲突项和待确认事项。',
            },
            {
                task_id: view.task_id,
                title: compactTitle(secondTitle),
                description: view.description,
                requirement: view.requirement,
            },
        ];
    }
    return [
        {
            task_id: view.task_id,
            title: compactTitle(`${view.title}准备`),
            description: `为${view.title}整理输入、依据和边界条件。`,
            requirement: '需输出可供下游使用的准备材料和待确认事项。',
        },
        {
            task_id: view.task_id,
            title: view.title,
            description: view.description,
            requirement: view.requirement,
        },
    ];
}

function mergedTitle(left: TaskView, right: TaskView): string {
    const leftCore = left.title.replace(/(整理|对照|分析|生成|定稿)$/, '');
    const rightCore = right.title.replace(/(整理|对照|分析|生成|定稿)$/, '');
    if (leftCore && rightCore && leftCore !== rightCore) {
        return compactTitle(`${leftCore}与${rightCore}`);
    }
    return compactTitle(`${left.title}整合`);
}

function viewForTopic(topic: string): TaskView {
    let title = compactTitle(topic);
    if (!/审查$|核查$|分析$|评估$|整理$|生成$/.test(title)) {
        title = compactTitle(`${title}核查`);
    }
    return {
        task_id: 't_new',
        title,
        description: `围绕${topic}补充独立任务节点，提取相关事实、依据、风险和待确认事项。`,
        requirement: `需完成${topic}相关核查，输出结论、依据、缺口和下游处理建议。`,
    };
}

function topicFromMessage(message: string): string | null {
    const stripped = message
        .replace(/(请|帮我|需要|要|把|给|一下|任务|节点|链条|太长|太短)/g, '')
        .replace(/[，。；;,.!！?？\s]+/g, '');
    return stripped.slice(0, 18) || null;
}

function compactTitle(title: string): string {
    const collapsed = title.replace(/[，。；;,.!！?？\s]+/g, '');
    return collapsed.slice(0, 14) || '补充任务';
}
