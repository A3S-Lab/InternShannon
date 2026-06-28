import { Logger } from '@nestjs/common';
import { BaseNodeExecutor, NodeExecutorResult } from './base.executor';
import { ExecutionContext } from '../execution-context';
import { WorkflowNode, WorkflowNodeType, LLMNodeData } from '../../domain/value-objects';
import { CancellationToken } from '../cancellation-token';
import { LLMCredentialResolver } from './llm-credential-resolver';
import { llmChatCompletion, type LlmUsage } from './llm-client';

/**
 * LLM Node Executor
 * Calls LLM APIs (OpenAI-compatible)
 *
 * Credential handling:
 *  - When a `credentialResolver` is supplied (trusted resolver mode), `data.apiKey`
 *    and `data.apiHost` on the workflow node are ignored. The resolver is
 *    the single source of truth, backed by the server-side config
 *    service (etcd in production). If the resolver does not know the
 *    requested model, execution fails fast — the executor never falls
 *    back to user-supplied credentials.
 *  - When no resolver is supplied (library / standalone usage), the
 *    executor reads credentials from `data.apiKey` / `data.apiHost` as
 *    before. This preserves backward compatibility for local tools and
 *    unit tests.
 */

/** Case-insensitive substring blocklist match for content moderation. Pure. */
export function matchesBlocklist(text: string, keywords: string[]): boolean {
    if (!text || keywords.length === 0) {
        return false;
    }
    const lower = text.toLowerCase();
    return keywords.some((keyword) => {
        const trimmed = keyword.trim().toLowerCase();
        return trimmed.length > 0 && lower.includes(trimmed);
    });
}

export class LLMNodeExecutor extends BaseNodeExecutor {
    readonly type = WorkflowNodeType.LLM;
    private readonly logger = new Logger(LLMNodeExecutor.name);

    constructor(private readonly credentialResolver?: LLMCredentialResolver) {
        super();
    }

    protected async doExecute(
        context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
        cancellationToken?: CancellationToken,
    ): Promise<NodeExecutorResult> {
        const data = node.data as LLMNodeData;

        // Extract LLM configuration from node data
        const {
            model,
            temperature = 0.7,
            maxTokens,
            systemPrompt,
            timeout,
            retryTimes = 0,
            responseFormat = 'text',
            jsonSchema,
        } = data;
        // Output type drives JSON enforcement: when "json", instruct the model to
        // return JSON and parse the response into a structured result.
        // Structured output (aligned with Dify): a configured JSON schema forces
        // JSON mode, steers the model with the schema, and validates the parsed
        // result — surfacing both `text` (raw) and `structured_output` (parsed).
        const structuredCfg = (data as Record<string, unknown>).structuredOutput as
            | { enabled?: boolean; schema?: unknown }
            | undefined;
        const structuredSchema =
            structuredCfg?.enabled && structuredCfg.schema && typeof structuredCfg.schema === 'object' && !Array.isArray(structuredCfg.schema)
                ? (structuredCfg.schema as Record<string, unknown>)
                : undefined;
        // JSON output is requested either by the (main) `outputType`/`structuredOutput`
        // controls or by the (Dify-parity) `responseFormat` field; treat any of them as
        // "structured" so the call takes the blocking, fully-buffered JSON path.
        const responseFormatJson = responseFormat === 'json_object' || responseFormat === 'json_schema';
        const jsonMode = (data as Record<string, unknown>).outputType === 'json' || Boolean(structuredSchema) || responseFormatJson;
        // Dify LLM advanced sampling params (not on the base LLMNodeData type).
        const { topP, frequencyPenalty, presencePenalty, stop } = data as LLMNodeData & {
            topP?: number;
            frequencyPenalty?: number;
            presencePenalty?: number;
            stop?: string[];
        };
        // Streaming output (Dify-style): when enabled (default) and a live delta sink is
        // installed (designer debug run), tokens stream to the canvas as they arrive.
        // Any JSON / structured output always takes the blocking path (parsed as one JSON object).
        const streamingEnabled = (data as { streaming?: boolean }).streaming !== false;


        // Resolve credentials. Trusted resolver mode: resolver wins, node data ignored.
        // Library/standalone mode: fall back to node data.
        let apiKey: string | undefined;
        let apiHost: string;
        // Model capability from the trusted config: reasoning models reject
        // `temperature` (HTTP 400), so omit it when the config says unsupported.
        // `supportsAttachment` gates whether image inputs are sent (vision models).
        let supportsTemperature: boolean | undefined;
        let supportsAttachment: boolean | undefined;
        // Model actually sent to the API. Trusted resolver mode overrides it with the resolver's
        // resolved id — when the node left `model` blank, that's the config service's
        // defaultModel (the internShannon vault default), so built-in / default LLM nodes run
        // on the platform default. Library/standalone must name a model; there is no
        // hardcoded fallback (see the !effectiveModel guard below).
        let effectiveModel = model;
        if (this.credentialResolver) {
            if (data.apiKey || data.apiHost) {
                this.logger.warn(
                    `LLM node ${node.id}: ignoring inline apiKey/apiHost; trusted resolver mode resolves credentials from the server config service.`,
                );
            }
            const resolved = await this.credentialResolver.resolve(data.model);
            if (!resolved) {
                throw new Error(
                    `LLM node ${node.id}: model "${data.model ?? '<default>'}" is not configured in the server config service; refusing to fall back to inline credentials.`,
                );
            }
            apiKey = resolved.apiKey;
            apiHost = resolved.apiHost;
            supportsTemperature = resolved.supportsTemperature;
            supportsAttachment = resolved.supportsAttachment;
            if (resolved.model) {
                effectiveModel = resolved.model;
            }
        } else {
            apiKey = data.apiKey;
            apiHost = data.apiHost ?? 'https://api.openai.com/v1';
        }

        // Get prompt from inputs or node data
        const prompt = (inputs.prompt as string) || (data.prompt as string) || '';

        if (!prompt) {
            throw new Error(`LLM node ${node.id}: prompt is required`);
        }

        // Content moderation (Dify safety parity): if an input keyword blocklist is
        // configured and the prompt matches, short-circuit with a preset reply instead
        // of calling the model. (Output moderation isn't done here — the success path
        // streams tokens, so a post-hoc check can't unsend them.)
        const moderation = (data as { moderation?: { enabled?: boolean; keywords?: unknown; presetReply?: unknown } }).moderation;
        if (moderation?.enabled) {
            const keywords = Array.isArray(moderation.keywords)
                ? moderation.keywords.filter((keyword): keyword is string => typeof keyword === 'string')
                : [];
            if (matchesBlocklist(prompt, keywords)) {
                const presetReply =
                    typeof moderation.presetReply === 'string' && moderation.presetReply.trim()
                        ? moderation.presetReply
                        : '抱歉，您的输入包含不被允许的内容，无法处理该请求。';
                return { outputs: { result: presetReply, moderated: true } };
            }
        }

        // Dify LLM "Context" parity: an optional RAG/context variable injected ahead
        // of the system prompt, so retrieved knowledge grounds the answer without
        // cluttering the user prompt. (Named ragContext to avoid shadowing the
        // ExecutionContext `context` param.)
        const ragContext = inputs.context ?? (data as LLMNodeData & { context?: unknown }).context;
        const contextText = ragContext === undefined || ragContext === null
            ? ''
            : (typeof ragContext === 'string' ? ragContext : JSON.stringify(ragContext)).trim();
        const effectiveSystemPrompt = contextText
            ? `<context>\n${contextText}\n</context>\n\n${systemPrompt ?? ''}`.trim()
            : systemPrompt;

        // Vision: collect image inputs (URLs / data-URIs) and send them only when the
        // model supports attachments — sending images to a text-only model errors.
        const imageInput = inputs.images ?? inputs.image;
        const images =
            supportsAttachment === false
                ? undefined
                : Array.isArray(imageInput)
                    ? imageInput.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
                    : typeof imageInput === 'string' && imageInput.trim()
                        ? [imageInput.trim()]
                        : undefined;

        // Memory: prior conversation turns mapped to the `history` input (typically a
        // conversation variable). Keep only well-formed {role, content} entries.
        const historyInput = inputs.history ?? inputs.memory;
        const history = Array.isArray(historyInput)
            ? historyInput
                  .filter(
                      (turn): turn is { role: string; content: string } =>
                          typeof turn === 'object' &&
                          turn !== null &&
                          typeof (turn as { role?: unknown }).role === 'string' &&
                          typeof (turn as { content?: unknown }).content === 'string',
                  )
                  .map(turn => ({ role: turn.role, content: turn.content }))
            : undefined;
        // Memory window: keep only the last N turns so a long conversation variable
        // doesn't overflow the model's context. 0/absent = no limit.
        const memoryWindow =
            typeof (data as { memoryWindow?: unknown }).memoryWindow === 'number'
                ? (data as { memoryWindow: number }).memoryWindow
                : 0;
        const windowedHistory = history && memoryWindow > 0 ? history.slice(-memoryWindow) : history;

        if (!apiKey) {
            throw new Error(`LLM node ${node.id}: apiKey is required`);
        }
        if (!effectiveModel) {
            // No hardcoded fallback: trusted config resolves the vault defaultModel; library/standalone
            // must name a model on the node.
            throw new Error(`LLM node ${node.id}: model is required (the node names none and no default was resolved)`);
        }

        // Default timeout: maxTokens * 10ms + 5s buffer, min 30s
        const effectiveTimeout = timeout || (maxTokens ? Math.max(30000, maxTokens * 10) : 60000);

        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= retryTimes; attempt++) {
            // Check cancellation before each attempt
            cancellationToken?.throwIfCancelled();

            try {
                let capturedUsage: LlmUsage | undefined;
                const raw = await llmChatCompletion({
                    apiKey,
                    apiHost,
                    model: effectiveModel,
                    // Omit temperature for models the config marks as not supporting
                    // it (reasoning models 400 otherwise).
                    temperature: supportsTemperature === false ? undefined : temperature,
                    maxTokens,
                    topP,
                    frequencyPenalty,
                    presencePenalty,
                    stop: Array.isArray(stop) ? stop.filter((s): s is string => typeof s === 'string' && s.length > 0) : undefined,
                    systemPrompt: effectiveSystemPrompt,
                    images: images && images.length > 0 ? images : undefined,
                    imageDetail: (data as { imageDetail?: 'low' | 'high' | 'auto' }).imageDetail,
                    history: windowedHistory && windowedHistory.length > 0 ? windowedHistory : undefined,
                    prompt,
                    timeout: effectiveTimeout,
                    cancellationToken,
                    // Forward the Dify-parity response-format controls. When a (main)
                    // structured-output schema or outputType=json is configured but no
                    // explicit json responseFormat, request json_object so the provider
                    // returns JSON.
                    responseFormat: responseFormatJson ? responseFormat : jsonMode ? 'json_object' : 'text',
                    jsonSchema: jsonSchema ?? structuredSchema,
                    // Stream tokens to the canvas as they arrive when streaming is
                    // enabled (default, Dify toggle data.streaming) and a live sink is
                    // installed (designer debug run). Any JSON / structured output is
                    // parsed as a whole object, so it always takes the blocking path.
                    onDelta:
                        streamingEnabled && !jsonMode && context.hasDeltaSink()
                            ? (text => context.emitDelta(node.id, text))
                            : undefined,
                    onUsage: usage => {
                        capturedUsage = usage;
                    },
                });

                // Structured output (main): parse, validate against the schema, and
                // surface both `text` (raw string, like Dify) and `structured_output`
                // (parsed). A validation failure throws → retried here, then handled by
                // the node's errorStrategy (E1) if exhausted.
                if (structuredSchema) {
                    const parsed = parseJsonLenient(raw);
                    const validationError = validateAgainstSchema(parsed, structuredSchema);
                    if (validationError) {
                        throw new Error(`LLM 结构化输出未通过 schema 校验: ${validationError}`);
                    }
                    return { outputs: { result: parsed, text: raw, structured_output: parsed, ...(capturedUsage ? { usage: capturedUsage } : {}) } };
                }

                // For json output, return the parsed structure so downstream nodes
                // (and the debug panel) get real JSON, not a string.
                return { outputs: { result: jsonMode ? parseJsonLenient(raw) : raw, text: raw, ...(capturedUsage ? { usage: capturedUsage } : {}) } };
            } catch (error) {
                lastError = error as Error;
                if (attempt < retryTimes) {
                    // Check cancellation before retry delay
                    cancellationToken?.throwIfCancelled();
                    // Exponential backoff
                    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
                }
            }
        }

        const message = lastError instanceof Error ? lastError.message : String(lastError);
        throw new Error(`LLM execution failed after ${retryTimes + 1} attempts: ${message}`);
    }
}

function describeJsonType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

/**
 * Minimal JSON-Schema validator for the Dify structured-output subset:
 * type (object/array/string/number/integer/boolean), object `properties` +
 * `required`, and array `items`. Returns a human-readable error path or
 * undefined when valid. No new dependency.
 *
 * ponytail: intentionally does not cover enum / oneOf / format / pattern —
 * upgrade to a full validator (ajv) if those become required.
 */
export function validateAgainstSchema(value: unknown, schema: Record<string, unknown>): string | undefined {
    const type = schema.type as string | undefined;
    // enum: the value must be one of the allowed literals (any type) — common in
    // Dify structured output for constrained-choice fields.
    if (Array.isArray(schema.enum) && !schema.enum.some(allowed => allowed === value)) {
        return `值不在枚举内,期望其一: ${JSON.stringify(schema.enum)}`;
    }
    if (type === 'object') {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
            return `期望 object,实际 ${describeJsonType(value)}`;
        }
        const record = value as Record<string, unknown>;
        const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
        for (const key of required) {
            if (!(key in record) || record[key] === undefined) {
                return `缺少必填字段 "${key}"`;
            }
        }
        const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
        for (const [key, subSchema] of Object.entries(properties)) {
            if (record[key] === undefined) continue;
            const error = validateAgainstSchema(record[key], subSchema);
            if (error) return `字段 "${key}": ${error}`;
        }
        return undefined;
    }
    if (type === 'array') {
        if (!Array.isArray(value)) return `期望 array,实际 ${describeJsonType(value)}`;
        const items = schema.items as Record<string, unknown> | undefined;
        if (items && typeof items === 'object') {
            for (let i = 0; i < value.length; i++) {
                const error = validateAgainstSchema(value[i], items);
                if (error) return `元素[${i}]: ${error}`;
            }
        }
        return undefined;
    }
    if (type === 'string') {
        if (typeof value !== 'string') return `期望 string,实际 ${describeJsonType(value)}`;
        if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
            return `字符串长度 ${value.length} 小于最小 ${schema.minLength}`;
        }
        if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
            return `字符串长度 ${value.length} 超过最大 ${schema.maxLength}`;
        }
        if (typeof schema.pattern === 'string') {
            try {
                if (!new RegExp(schema.pattern).test(value)) return `不匹配正则 ${schema.pattern}`;
            } catch {
                // 无效正则:跳过(不因 schema 本身错误而误判数据)
            }
        }
        return undefined;
    }
    if (type === 'integer') {
        if (!(typeof value === 'number' && Number.isInteger(value))) return `期望 integer,实际 ${describeJsonType(value)}`;
        return numberBounds(value, schema);
    }
    if (type === 'number') {
        if (typeof value !== 'number') return `期望 number,实际 ${describeJsonType(value)}`;
        return numberBounds(value, schema);
    }
    if (type === 'boolean') return typeof value === 'boolean' ? undefined : `期望 boolean,实际 ${describeJsonType(value)}`;
    return undefined;
}

/** Validate JSON-schema numeric bounds (minimum / maximum). */
function numberBounds(value: number, schema: Record<string, unknown>): string | undefined {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return `数值 ${value} 小于最小 ${schema.minimum}`;
    if (typeof schema.maximum === 'number' && value > schema.maximum) return `数值 ${value} 超过最大 ${schema.maximum}`;
    return undefined;
}

/**
 * Parse a model's JSON response leniently: strip a leading/trailing Markdown
 * code fence (```json … ```) the model may have added, then JSON.parse. Falls
 * back to the raw string when it isn't valid JSON so the node never hard-fails
 * on a slightly-off response.
 */
function parseJsonLenient(raw: string): unknown {
    const trimmed = raw.trim();
    const unfenced = trimmed
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    try {
        return JSON.parse(unfenced);
    } catch {
        return raw;
    }
}
