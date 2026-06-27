import { LLMNodeExecutor, matchesBlocklist } from '../llm.executor';
import { ExecutionContext } from '../../execution-context';
import { WorkflowDefinition, WorkflowExecution, ExecutionStatus } from '../../../domain/entities';
import { WorkflowNode, WorkflowNodeType, LLMNodeData, FlowValueType } from '../../../domain/value-objects';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('LLMNodeExecutor', () => {
    let executor: LLMNodeExecutor;
    let context: ExecutionContext;
    let execution: WorkflowExecution;
    let definition: WorkflowDefinition;
    let node: WorkflowNode;

    beforeEach(() => {
        executor = new LLMNodeExecutor();
        mockFetch.mockReset();

        execution = {
            id: 'exec-1',
            workflowDefinitionId: 'def-1',
            version: '1.0.0',
            input: {},
            status: ExecutionStatus.Running,
            currentNodeIds: [],
            executedNodeIds: [],
            failedNodeIds: [],
            variables: {},
            nodeOutputs: {},
            createdAt: new Date(),
        };

        definition = {
            id: 'def-1',
            packageId: 'pkg-1',
            version: '1.0.0',
            name: 'Test Workflow',
            graph: { nodes: [], edges: [] },
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        node = {
            id: 'llm-1',
            type: WorkflowNodeType.LLM,
            name: 'LLM',
            data: {
                model: 'gpt-4',
                apiKey: 'test-api-key',
                apiHost: 'https://api.openai.com/v1',
                temperature: 0.7,
                prompt: 'Hello world',
            } as LLMNodeData,
        };

        context = new ExecutionContext(
            execution,
            definition,
            null as any,
            new Map([[node.id, node]]),
            new Map(),
        );
    });

    it('should have correct type', () => {
        expect(executor.type).toBe(WorkflowNodeType.LLM);
    });

    it('should throw error when prompt is missing', async () => {
        node.data = {
            model: 'gpt-4',
            apiKey: 'test-api-key',
            apiHost: 'https://api.openai.com/v1',
        } as LLMNodeData;

        await expect(executor.execute(context, node)).rejects.toThrow('prompt is required');
    });

    it('should throw error when apiKey is missing', async () => {
        node.data = {
            model: 'gpt-4',
            apiHost: 'https://api.openai.com/v1',
            prompt: 'Hello',
        } as LLMNodeData;

        await expect(executor.execute(context, node)).rejects.toThrow('apiKey is required');
    });

    it('should use prompt from inputs when not in node data', async () => {
        node.data = {
            model: 'gpt-4',
            apiKey: 'test-api-key',
            apiHost: 'https://api.openai.com/v1',
            inputsValues: {
                prompt: { type: FlowValueType.Static, value: 'Hello from inputs' },
            },
        } as LLMNodeData;

        // Mock successful response
        mockFetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({
                choices: [{ message: { content: 'AI response' } }],
            }),
        });

        const result = await executor.execute(context, node);

        expect(result.outputs).toBeDefined();
    });

    it('injects an optional Context variable ahead of the system prompt (Dify LLM context)', async () => {
        node.data = {
            model: 'gpt-4',
            apiKey: 'test-api-key',
            apiHost: 'https://api.openai.com/v1',
            systemPrompt: 'You are helpful.',
            inputsValues: {
                prompt: { type: FlowValueType.Static, value: 'Q?' },
                context: { type: FlowValueType.Static, value: 'Retrieved knowledge XYZ' },
            },
        } as LLMNodeData;
        mockFetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({ choices: [{ message: { content: 'A' } }] }),
        });

        await executor.execute(context, node);

        const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
        const systemMsg = body.messages.find((m: { role: string }) => m.role === 'system');
        expect(systemMsg.content).toContain('Retrieved knowledge XYZ');
        expect(systemMsg.content).toContain('You are helpful.');
    });

    it('forwards Dify advanced sampling params (top_p / penalties / stop) to the request body', async () => {
        node.data = {
            model: 'gpt-4',
            apiKey: 'k',
            apiHost: 'https://api.openai.com/v1',
            prompt: 'Hi',
            topP: 0.9,
            frequencyPenalty: 0.5,
            presencePenalty: 0.3,
            stop: ['END', ''], // empty entries are filtered out
        } as LLMNodeData;
        mockFetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({ choices: [{ message: { content: 'A' } }] }),
        });

        await executor.execute(context, node);

        const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
        expect(body.top_p).toBe(0.9);
        expect(body.frequency_penalty).toBe(0.5);
        expect(body.presence_penalty).toBe(0.3);
        expect(body.stop).toEqual(['END']);
    });

    it('captures provider token usage and exposes it on the output (Dify tokens metadata)', async () => {
        node.data = { model: 'gpt-4', apiKey: 'k', apiHost: 'https://api.openai.com/v1', prompt: 'Hi' } as LLMNodeData;
        mockFetch.mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({
                choices: [{ message: { content: 'Hello' } }],
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            }),
        });

        const result = await executor.execute(context, node);

        expect(result.outputs).toEqual({
            result: 'Hello',
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        });
    });

    describe('token streaming (delta sink installed)', () => {
        function sseStream(lines: string[]): ReadableStream<Uint8Array> {
            const encoder = new TextEncoder();
            return new ReadableStream({
                start(controller) {
                    for (const line of lines) {
                        controller.enqueue(encoder.encode(line));
                    }
                    controller.close();
                },
            });
        }

        it('streams tokens to the sink and returns the accumulated text', async () => {
            const deltas: Array<{ nodeId: string; text: string }> = [];
            context.setDeltaSink((nodeId, text) => deltas.push({ nodeId, text }));
            mockFetch.mockResolvedValue({
                ok: true,
                body: sseStream([
                    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
                    'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
                    'data: [DONE]\n',
                ]),
            });

            const result = await executor.execute(context, node);

            expect(deltas).toEqual([
                { nodeId: 'llm-1', text: 'Hel' },
                { nodeId: 'llm-1', text: 'lo' },
            ]);
            expect(result.outputs).toEqual({ result: 'Hello' });
            const [, init] = mockFetch.mock.calls[0];
            expect(JSON.parse(init.body).stream).toBe(true);
        });

        it('takes the blocking JSON path (no stream flag) when no sink is installed', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({ choices: [{ message: { content: 'whole answer' } }] }),
            });

            const result = await executor.execute(context, node);

            expect(result.outputs).toEqual({ result: 'whole answer' });
            const [, init] = mockFetch.mock.calls[0];
            expect(JSON.parse(init.body).stream).toBeUndefined();
        });

        it('forces the blocking path when streaming is disabled, even with a sink installed', async () => {
            const deltas: Array<{ nodeId: string; text: string }> = [];
            context.setDeltaSink((nodeId, text) => deltas.push({ nodeId, text }));
            node.data = { model: 'gpt-4', apiKey: 'k', apiHost: 'https://h/v1', prompt: 'Hi', streaming: false } as LLMNodeData;
            mockFetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({ choices: [{ message: { content: 'whole answer' } }] }),
            });

            const result = await executor.execute(context, node);

            expect(deltas).toEqual([]); // streaming disabled → no tokens pushed to the sink
            expect(result.outputs).toEqual({ result: 'whole answer' });
            expect(JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body).stream).toBeUndefined();
        });
    });

    describe('structured output (responseFormat)', () => {
        it('parses JSON output and exposes it as `result` with raw `text`', async () => {
            node.data = { ...node.data, responseFormat: 'json_object' } as LLMNodeData;
            mockFetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    choices: [{ message: { content: '{"score": 9, "label": "vip"}' } }],
                }),
            });

            const result = await executor.execute(context, node);

            expect(result.outputs).toEqual({
                result: { score: 9, label: 'vip' },
                text: '{"score": 9, "label": "vip"}',
            });
            const [, init] = mockFetch.mock.calls[0];
            const body = JSON.parse(init.body);
            expect(body.response_format).toEqual({ type: 'json_object' });
            // structured output never streams (whole-JSON parse)
            expect(body.stream).toBeUndefined();
        });

        it('does not stream structured output even when a sink is installed', async () => {
            node.data = { ...node.data, responseFormat: 'json_schema', jsonSchema: { type: 'object' } } as LLMNodeData;
            context.setDeltaSink(() => { throw new Error('should not stream structured output'); });
            mockFetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({ choices: [{ message: { content: '{"ok": true}' } }] }),
            });

            const result = await executor.execute(context, node);

            expect(result.outputs).toEqual({ result: { ok: true }, text: '{"ok": true}' });
            const [, init] = mockFetch.mock.calls[0];
            expect(JSON.parse(init.body).response_format.type).toBe('json_schema');
        });

        it('fails clearly when the model returns non-JSON in a JSON mode', async () => {
            node.data = { ...node.data, responseFormat: 'json_object' } as LLMNodeData;
            mockFetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({ choices: [{ message: { content: 'not json at all' } }] }),
            });

            await expect(executor.execute(context, node)).rejects.toThrow('not valid JSON');
        });
    });

    describe('with credentialResolver (trusted resolver mode)', () => {
        const resolver = {
            resolve: jest.fn(),
        };

        beforeEach(() => {
            resolver.resolve.mockReset();
            executor = new LLMNodeExecutor(resolver);
            mockFetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    choices: [{ message: { content: 'resolved response' } }],
                }),
            });
        });

        it('uses resolver credentials and ignores inline node apiKey/apiHost', async () => {
            resolver.resolve.mockResolvedValue({
                apiKey: 'etcd-key',
                apiHost: 'https://etcd-host/v1',
            });
            node.data = {
                model: 'gpt-4',
                apiKey: 'inline-key-should-be-ignored',
                apiHost: 'https://attacker.example.com/v1',
                prompt: 'Hi',
            } as LLMNodeData;

            await executor.execute(context, node);

            expect(resolver.resolve).toHaveBeenCalledWith('gpt-4');
            expect(mockFetch).toHaveBeenCalledTimes(1);
            const [endpoint, init] = mockFetch.mock.calls[0];
            expect(endpoint).toBe('https://etcd-host/v1/chat/completions');
            expect(init.headers.Authorization).toBe('Bearer etcd-key');
        });

        it('calls the resolver-resolved model when the node left model blank (vault defaultModel)', async () => {
            // Built-in / default LLM nodes ship with model:'' and rely on the config
            // service's defaultModel. The resolver returns that id; the executor must
            // call it — not the empty string and not the hardcoded 'gpt-4' fallback.
            resolver.resolve.mockResolvedValue({ apiKey: 'k', apiHost: 'https://h/v1', model: 'openai/glm5.1-w4a8' });
            node.data = { model: '', prompt: 'Hi' } as LLMNodeData;

            await executor.execute(context, node);

            expect(resolver.resolve).toHaveBeenCalledWith('');
            const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
            expect(body.model).toBe('openai/glm5.1-w4a8');
        });

        it('omits temperature when the resolved model does not support it (reasoning models 400 otherwise)', async () => {
            resolver.resolve.mockResolvedValue({ apiKey: 'k', apiHost: 'https://h/v1', supportsTemperature: false });
            node.data = { model: 'reasoning-model', prompt: 'Hi', temperature: 0.7 } as LLMNodeData;

            await executor.execute(context, node);

            const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
            expect(body.temperature).toBeUndefined();
            expect(body.model).toBe('reasoning-model');
        });

        it('still sends temperature when the model supports it', async () => {
            resolver.resolve.mockResolvedValue({ apiKey: 'k', apiHost: 'https://h/v1', supportsTemperature: true });
            node.data = { model: 'gpt-4', prompt: 'Hi', temperature: 0.3 } as LLMNodeData;

            await executor.execute(context, node);

            const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
            expect(body.temperature).toBe(0.3);
        });

        it('sends images as multimodal content when the model supports attachments (Vision)', async () => {
            resolver.resolve.mockResolvedValue({ apiKey: 'k', apiHost: 'https://h/v1', supportsAttachment: true });
            node.data = {
                model: 'vl-model',
                inputsValues: {
                    prompt: { type: FlowValueType.Static, value: 'What is this?' },
                    images: { type: FlowValueType.Static, value: ['https://img/a.png'] },
                },
            } as LLMNodeData;

            await executor.execute(context, node);

            const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
            const userMsg = body.messages.find((m: { role: string }) => m.role === 'user');
            expect(Array.isArray(userMsg.content)).toBe(true);
            expect(userMsg.content).toEqual([
                { type: 'text', text: 'What is this?' },
                { type: 'image_url', image_url: { url: 'https://img/a.png' } },
            ]);
        });

        it('passes image detail (low/high/auto) into the image_url block (Dify vision token control)', async () => {
            resolver.resolve.mockResolvedValue({ apiKey: 'k', apiHost: 'https://h/v1', supportsAttachment: true });
            node.data = {
                model: 'vl-model',
                imageDetail: 'high',
                inputsValues: {
                    prompt: { type: FlowValueType.Static, value: 'Q' },
                    images: { type: FlowValueType.Static, value: ['https://img/a.png'] },
                },
            } as LLMNodeData;

            await executor.execute(context, node);

            const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
            const userMsg = body.messages.find((m: { role: string }) => m.role === 'user');
            expect(userMsg.content[1]).toEqual({ type: 'image_url', image_url: { url: 'https://img/a.png', detail: 'high' } });
        });

        it('content moderation: short-circuits a blocklisted prompt with the preset reply (no model call)', async () => {
            resolver.resolve.mockResolvedValue({ apiKey: 'k', apiHost: 'https://h/v1' });
            node.data = {
                model: 'gpt-4',
                moderation: { enabled: true, keywords: ['forbidden'], presetReply: 'blocked.' },
                inputsValues: { prompt: { type: FlowValueType.Static, value: 'this is FORBIDDEN content' } },
            } as LLMNodeData;

            const result = await executor.execute(context, node);

            expect(result.outputs).toEqual({ result: 'blocked.', moderated: true });
            expect(mockFetch).not.toHaveBeenCalled(); // the model was never called
        });

        it('threads conversation history between system prompt and user message (Memory)', async () => {
            resolver.resolve.mockResolvedValue({ apiKey: 'k', apiHost: 'https://h/v1' });
            node.data = {
                model: 'gpt-4',
                systemPrompt: 'You are helpful.',
                inputsValues: {
                    prompt: { type: FlowValueType.Static, value: 'And the third?' },
                    history: {
                        type: FlowValueType.Static,
                        value: [
                            { role: 'user', content: 'First?' },
                            { role: 'assistant', content: 'One.' },
                            { role: 'garbage' }, // dropped: no content
                        ],
                    },
                },
            } as LLMNodeData;

            await executor.execute(context, node);

            const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
            expect(body.messages).toEqual([
                { role: 'system', content: 'You are helpful.' },
                { role: 'user', content: 'First?' },
                { role: 'assistant', content: 'One.' },
                { role: 'user', content: 'And the third?' },
            ]);
        });

        it('memoryWindow keeps only the last N history turns', async () => {
            resolver.resolve.mockResolvedValue({ apiKey: 'k', apiHost: 'https://h/v1' });
            node.data = {
                model: 'gpt-4',
                memoryWindow: 2,
                inputsValues: {
                    prompt: { type: FlowValueType.Static, value: 'now' },
                    history: {
                        type: FlowValueType.Static,
                        value: [
                            { role: 'user', content: 't1' },
                            { role: 'assistant', content: 't2' },
                            { role: 'user', content: 't3' },
                            { role: 'assistant', content: 't4' },
                        ],
                    },
                },
            } as LLMNodeData;

            await executor.execute(context, node);

            const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
            // window=2 → only the last 2 turns survive, then the current user message.
            expect(body.messages).toEqual([
                { role: 'user', content: 't3' },
                { role: 'assistant', content: 't4' },
                { role: 'user', content: 'now' },
            ]);
        });

        it('does NOT send images to a model that lacks attachment support (text-only stays string)', async () => {
            resolver.resolve.mockResolvedValue({ apiKey: 'k', apiHost: 'https://h/v1', supportsAttachment: false });
            node.data = {
                model: 'text-model',
                inputsValues: {
                    prompt: { type: FlowValueType.Static, value: 'Hi' },
                    images: { type: FlowValueType.Static, value: ['https://img/a.png'] },
                },
            } as LLMNodeData;

            await executor.execute(context, node);

            const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
            const userMsg = body.messages.find((m: { role: string }) => m.role === 'user');
            expect(userMsg.content).toBe('Hi');
        });

        it('throws when the resolver does not know the requested model (no fallback to inline)', async () => {
            resolver.resolve.mockResolvedValue(undefined);
            node.data = {
                model: 'mystery-model',
                apiKey: 'inline-key-should-be-ignored',
                apiHost: 'https://attacker.example.com/v1',
                prompt: 'Hi',
            } as LLMNodeData;

            await expect(executor.execute(context, node)).rejects.toThrow(
                /not configured in the server config service/,
            );
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('still throws on missing prompt even when resolver is set', async () => {
            resolver.resolve.mockResolvedValue({
                apiKey: 'etcd-key',
                apiHost: 'https://etcd-host/v1',
            });
            node.data = {
                model: 'gpt-4',
            } as LLMNodeData;

            await expect(executor.execute(context, node)).rejects.toThrow('prompt is required');
        });

        it('passes undefined model name through to the resolver', async () => {
            resolver.resolve.mockResolvedValue({
                apiKey: 'etcd-key',
                apiHost: 'https://etcd-host/v1',
                model: 'glm5.1-w4a8', // trusted config resolves the vault defaultModel when the node names none
            });
            node.data = { prompt: 'Hi' } as LLMNodeData;

            await executor.execute(context, node);
            expect(resolver.resolve).toHaveBeenCalledWith(undefined);
        });
    });
});
