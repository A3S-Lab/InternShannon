import { CancellationToken } from '../cancellation-token';
import { LLMCredentialResolver } from './llm-credential-resolver';

/**
 * Resolve LLM credentials the same way the LLM node does, so all LLM-backed nodes
 * (LLM / Question-Classifier / Parameter-Extractor) share one credential policy:
 * a resolver (trusted resolver mode) is authoritative and inline keys are ignored; without a
 * resolver (library/standalone) inline `apiKey`/`apiHost` are used.
 */
export async function resolveLlmCredentials(
    resolver: LLMCredentialResolver | undefined,
    data: { model?: string; apiKey?: string; apiHost?: string },
    nodeId: string,
): Promise<{ apiKey: string; apiHost: string; model: string }> {
    if (resolver) {
        const resolved = await resolver.resolve(data.model);
        if (!resolved) {
            throw new Error(
                `Node ${nodeId}: model "${data.model ?? '<default>'}" is not configured in the server config service; refusing to fall back to inline credentials.`,
            );
        }
        // Trusted config resolves the model id too — the config service's defaultModel (the ShuanOS
        // vault default) when the node names none — so callers run on the vault default
        // rather than a model hardcoded in the executor.
        const model = resolved.model ?? data.model;
        if (!model) {
            throw new Error(`Node ${nodeId}: no model configured and the server config service resolved no default model.`);
        }
        return { apiKey: resolved.apiKey, apiHost: resolved.apiHost, model };
    }
    if (!data.apiKey) {
        throw new Error(`Node ${nodeId}: apiKey is required`);
    }
    if (!data.model) {
        throw new Error(`Node ${nodeId}: model is required`);
    }
    return { apiKey: data.apiKey, apiHost: data.apiHost ?? 'https://api.openai.com/v1', model: data.model };
}

/** Token usage (Dify-style metadata), normalized from the OpenAI `usage` block. */
export interface LlmUsage {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
}

function toLlmUsage(raw: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined): LlmUsage | undefined {
    if (!raw) return undefined;
    return { promptTokens: raw.prompt_tokens, completionTokens: raw.completion_tokens, totalTokens: raw.total_tokens };
}

/**
 * Shared OpenAI-compatible chat-completion client used by the LLM node and the
 * LLM-backed nodes (Question-Classifier, Parameter-Extractor). Keeping one client
 * means structured output, streaming, timeout/cancellation, and error handling
 * behave identically everywhere instead of drifting across copy-pasted callers.
 */
export interface LlmChatCompletionOptions {
    apiKey: string;
    apiHost: string;
    model: string;
    /** Optional: omitted from the request when undefined (reasoning models 400 on it). */
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
    prompt: string;
    timeout: number;
    cancellationToken?: CancellationToken;
    /** When set, request `stream: true` and forward each chunk as it arrives. */
    onDelta?: (text: string) => void;
    responseFormat?: 'text' | 'json_object' | 'json_schema';
    jsonSchema?: Record<string, unknown>;
    /** Image URLs/data-URIs for vision models (OpenAI multimodal content). When
     *  present the user message becomes a content array of text + image blocks. */
    images?: string[];
    /** Vision image fidelity (Dify low/high/auto) — controls vision token cost. */
    imageDetail?: 'low' | 'high' | 'auto';
    /** Prior conversation turns (Dify LLM Memory). Inserted between the system
     *  prompt and the current user message so the model has chat context. */
    history?: Array<{ role: string; content: string }>;
    /** Nucleus sampling (OpenAI top_p). Omitted from the request when undefined. */
    topP?: number;
    /** Penalize tokens by existing frequency (OpenAI frequency_penalty, -2..2). */
    frequencyPenalty?: number;
    /** Penalize tokens already present (OpenAI presence_penalty, -2..2). */
    presencePenalty?: number;
    /** Stop sequences — generation halts when any is produced (OpenAI stop). */
    stop?: string[];
    /** Reports token usage when the provider returns it (blocking, or streaming via
     *  stream_options.include_usage). Lets callers surface Dify-style tokens metadata. */
    onUsage?: (usage: LlmUsage) => void;
}

export async function llmChatCompletion(options: LlmChatCompletionOptions): Promise<string> {
    const {
        apiKey, apiHost, model, temperature, maxTokens, systemPrompt, prompt,
        timeout, cancellationToken, onDelta, responseFormat, jsonSchema, images, imageDetail, history,
        topP, frequencyPenalty, presencePenalty, stop, onUsage,
    } = options;

    const messages: Array<{ role: string; content: unknown }> = [];
    if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
    }
    // Memory: prior conversation turns go between the system prompt and the current
    // user message, so the model sees the chat history.
    if (history) {
        for (const turn of history) {
            messages.push({ role: turn.role, content: turn.content });
        }
    }
    // Vision (multimodal): when images are supplied, the user content is an array of
    // a text block plus one image_url block per image (OpenAI-compatible). Otherwise
    // it stays a plain string for normal text models.
    const userContent =
        images && images.length > 0
            ? [
                  { type: 'text', text: prompt },
                  ...images.map(url => ({ type: 'image_url', image_url: { url, ...(imageDetail ? { detail: imageDetail } : {}) } })),
              ]
            : prompt;
    messages.push({ role: 'user', content: userContent });

    const requestBody: Record<string, unknown> = { model, messages };
    if (temperature !== undefined) {
        requestBody.temperature = temperature;
    }
    if (maxTokens) {
        requestBody.max_tokens = maxTokens;
    }
    if (topP !== undefined) {
        requestBody.top_p = topP;
    }
    if (frequencyPenalty !== undefined) {
        requestBody.frequency_penalty = frequencyPenalty;
    }
    if (presencePenalty !== undefined) {
        requestBody.presence_penalty = presencePenalty;
    }
    if (stop && stop.length > 0) {
        requestBody.stop = stop;
    }
    if (responseFormat === 'json_object') {
        requestBody.response_format = { type: 'json_object' };
    } else if (responseFormat === 'json_schema') {
        requestBody.response_format = {
            type: 'json_schema',
            json_schema: { name: 'workflow_output', schema: jsonSchema ?? {}, strict: true },
        };
    }
    const streaming = Boolean(onDelta);
    if (streaming) {
        requestBody.stream = true;
        // Ask for a final usage chunk so streamed runs can still report token counts.
        requestBody.stream_options = { include_usage: true };
    }

    const endpoint = apiHost.endsWith('/') ? `${apiHost}chat/completions` : `${apiHost}/chat/completions`;

    const controller = new AbortController();
    const timeoutSignal = AbortSignal.timeout(timeout);
    const onAbort = () => controller.abort();
    timeoutSignal.addEventListener('abort', onAbort);
    if (cancellationToken) {
        cancellationToken.onCancelled(onAbort);
    }

    let response: Response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
        });
    } finally {
        timeoutSignal.removeEventListener('abort', onAbort);
        if (cancellationToken) {
            cancellationToken.unregister(onAbort);
        }
    }

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM API error ${response.status}: ${errorText}`);
    }

    if (streaming && onDelta) {
        return consumeLLMStream(response, onDelta, onUsage);
    }

    const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    if (data.error) {
        throw new Error(`LLM API error: ${data.error.message}`);
    }
    const usage = toLlmUsage(data.usage);
    if (usage && onUsage) {
        onUsage(usage);
    }
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error('LLM returned empty response');
    }
    return content;
}

/**
 * Consume an OpenAI-compatible SSE stream (`stream: true`): parse each
 * `data: {json}` line, push `choices[0].delta.content` to `onDelta` as it arrives,
 * and return the full accumulated text. Malformed keep-alive lines are skipped; a
 * `[DONE]` sentinel ends the stream.
 */
export async function consumeLLMStream(
    response: Response,
    onDelta: (text: string) => void,
    onUsage?: (usage: LlmUsage) => void,
): Promise<string> {
    const body = response.body as ReadableStream<Uint8Array> | null;
    if (!body) {
        throw new Error('LLM streaming response has no body');
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            let newlineIndex: number;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newlineIndex).trim();
                buffer = buffer.slice(newlineIndex + 1);
                if (!line.startsWith('data:')) {
                    continue;
                }
                const payload = line.slice(5).trim();
                if (!payload || payload === '[DONE]') {
                    continue;
                }
                let parsed: {
                    choices?: Array<{ delta?: { content?: string } }>;
                    error?: { message?: string };
                    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
                };
                try {
                    parsed = JSON.parse(payload);
                } catch {
                    continue; // keep-alive / partial line — skip
                }
                if (parsed.error) {
                    throw new Error(`LLM API error: ${parsed.error.message}`);
                }
                // The final usage chunk (stream_options.include_usage) carries token counts
                // with an empty choices array — capture it before the content check.
                const usage = toLlmUsage(parsed.usage);
                if (usage && onUsage) {
                    onUsage(usage);
                }
                const chunk = parsed.choices?.[0]?.delta?.content;
                if (typeof chunk === 'string' && chunk) {
                    content += chunk;
                    onDelta(chunk);
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
    if (!content) {
        throw new Error('LLM returned empty response');
    }
    return content;
}
