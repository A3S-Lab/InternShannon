import { BaseNodeExecutor, NodeExecutorResult } from './base.executor';
import { ExecutionContext } from '../execution-context';
import { WorkflowNode, WorkflowNodeType } from '../../domain/value-objects';
import { CancellationToken } from '../cancellation-token';
import { LLMCredentialResolver } from './llm-credential-resolver';
import { llmChatCompletion, resolveLlmCredentials } from './llm-client';

interface ClassifierClass {
    id: string;
    name: string;
    /** Successor node to route to when this class is selected (branch routing). */
    targetNodeId?: string;
}

interface QuestionClassifierData {
    model?: string;
    apiKey?: string;
    apiHost?: string;
    temperature?: number;
    timeout?: number;
    instruction?: string;
    query?: string;
    classes?: ClassifierClass[];
}

/**
 * Question-Classifier node (Dify parity): routes the input query into one of N
 * labeled classes using an LLM, then emits the selected class's `targetNodeId` as
 * the branch — so the core engine skips the not-taken classes exactly like an
 * IF/ELSE. The classification call asks for JSON (`{ "classId": "..." }`) to keep
 * parsing robust. Reuses the shared LLM client + credential policy.
 */
export class QuestionClassifierNodeExecutor extends BaseNodeExecutor {
    readonly type = WorkflowNodeType.QuestionClassifier;

    constructor(private readonly credentialResolver?: LLMCredentialResolver) {
        super();
    }

    protected async doExecute(
        _context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
        cancellationToken?: CancellationToken,
    ): Promise<NodeExecutorResult> {
        const data = (node.data ?? {}) as QuestionClassifierData;
        const classes = (data.classes ?? []).filter(c => c && typeof c.id === 'string' && c.id);
        if (classes.length === 0) {
            throw new Error(`Question-classifier node ${node.id}: at least one class is required`);
        }

        const query = this.asText(inputs.query ?? data.query ?? inputs.input ?? inputs.text);
        if (!query) {
            throw new Error(`Question-classifier node ${node.id}: query is required`);
        }

        const { apiKey, apiHost, model } = await resolveLlmCredentials(this.credentialResolver, data, node.id);

        const classList = classes
            .map((c, i) => `${i + 1}. id="${c.id}" — ${c.name || c.id}`)
            .join('\n');
        const systemPrompt = [
            'You are a strict text classifier.',
            data.instruction?.trim() ? `Additional guidance: ${data.instruction.trim()}` : '',
            'Choose exactly one category for the user input from the list below.',
            'Respond with ONLY a JSON object of the form {"classId": "<id>"} using one of the given ids.',
            '',
            'Categories:',
            classList,
        ].filter(Boolean).join('\n');

        const raw = await llmChatCompletion({
            apiKey,
            apiHost,
            model,
            temperature: typeof data.temperature === 'number' ? data.temperature : 0,
            systemPrompt,
            prompt: query,
            timeout: data.timeout ?? 30000,
            cancellationToken,
            responseFormat: 'json_object',
        });

        const selected = this.pickClass(raw, classes);
        return {
            outputs: { class: selected.name || selected.id, classId: selected.id, query },
            ...(selected.targetNodeId ? { branch: selected.targetNodeId } : {}),
        };
    }

    /** Parse the model's JSON answer and map it to a declared class. Falls back to
     *  a substring match (model echoed the id/name in prose), then to the first
     *  class — a classifier must always pick a branch, never strand the run. */
    private pickClass(raw: string, classes: ClassifierClass[]): ClassifierClass {
        let answer = '';
        try {
            const parsed = JSON.parse(raw) as { classId?: unknown; class?: unknown };
            answer = this.asText(parsed.classId ?? parsed.class);
        } catch {
            answer = raw;
        }
        const normalized = answer.trim().toLowerCase();
        const exact = classes.find(c => c.id.toLowerCase() === normalized || (c.name ?? '').toLowerCase() === normalized);
        if (exact) {
            return exact;
        }
        const fuzzy = classes.find(c => normalized.includes(c.id.toLowerCase()) || (c.name && normalized.includes(c.name.toLowerCase())));
        return fuzzy ?? classes[0];
    }

    private asText(value: unknown): string {
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        return '';
    }
}
