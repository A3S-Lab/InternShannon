import { BaseNodeExecutor, NodeExecutorResult } from './base.executor';
import { ExecutionContext } from '../execution-context';
import { WorkflowNode, WorkflowNodeType } from '../../domain/value-objects';
import { CancellationToken } from '../cancellation-token';
import { LLMCredentialResolver } from './llm-credential-resolver';
import { llmChatCompletion, resolveLlmCredentials } from './llm-client';

interface ExtractorParameter {
    name: string;
    type?: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description?: string;
    required?: boolean;
}

interface ParameterExtractorData {
    model?: string;
    apiKey?: string;
    apiHost?: string;
    temperature?: number;
    timeout?: number;
    instruction?: string;
    text?: string;
    parameters?: ExtractorParameter[];
}

/**
 * Parameter-Extractor node (Dify parity): pulls a declared set of typed parameters
 * out of free text using the LLM's structured-output (json_schema) mode, then
 * exposes each extracted field as a node output so downstream nodes can reference
 * `${nodes.extract.output.<name>}`. Builds the JSON schema from the declared
 * parameters and reuses the shared LLM client.
 */
export class ParameterExtractorNodeExecutor extends BaseNodeExecutor {
    readonly type = WorkflowNodeType.ParameterExtractor;

    constructor(private readonly credentialResolver?: LLMCredentialResolver) {
        super();
    }

    protected async doExecute(
        _context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
        cancellationToken?: CancellationToken,
    ): Promise<NodeExecutorResult> {
        const data = (node.data ?? {}) as ParameterExtractorData;
        const parameters = (data.parameters ?? []).filter(p => p && typeof p.name === 'string' && p.name);
        if (parameters.length === 0) {
            throw new Error(`Parameter-extractor node ${node.id}: at least one parameter is required`);
        }

        const text = this.asText(inputs.text ?? data.text ?? inputs.query ?? inputs.input);
        if (!text) {
            throw new Error(`Parameter-extractor node ${node.id}: input text is required`);
        }

        const { apiKey, apiHost, model } = await resolveLlmCredentials(this.credentialResolver, data, node.id);

        const schema = this.buildSchema(parameters);
        const systemPrompt = [
            'You extract structured parameters from the user text.',
            data.instruction?.trim() ? `Additional guidance: ${data.instruction.trim()}` : '',
            'Return ONLY a JSON object matching the provided schema. Use null for parameters you cannot find.',
        ].filter(Boolean).join('\n');

        const raw = await llmChatCompletion({
            apiKey,
            apiHost,
            model,
            temperature: typeof data.temperature === 'number' ? data.temperature : 0,
            systemPrompt,
            prompt: text,
            timeout: data.timeout ?? 30000,
            cancellationToken,
            responseFormat: 'json_schema',
            jsonSchema: schema,
        });

        let extracted: Record<string, unknown>;
        try {
            extracted = JSON.parse(raw) as Record<string, unknown>;
        } catch {
            throw new Error(`Parameter-extractor node ${node.id}: model output is not valid JSON`);
        }

        // Project only the declared parameters as outputs (drop any extras the model
        // invented), so downstream references resolve to exactly the declared shape.
        const outputs: Record<string, unknown> = {};
        for (const param of parameters) {
            outputs[param.name] = extracted[param.name] ?? null;
        }
        return { outputs };
    }

    private buildSchema(parameters: ExtractorParameter[]): Record<string, unknown> {
        const properties: Record<string, unknown> = {};
        const required: string[] = [];
        for (const param of parameters) {
            properties[param.name] = {
                type: param.type ?? 'string',
                ...(param.description ? { description: param.description } : {}),
            };
            if (param.required) {
                required.push(param.name);
            }
        }
        return {
            type: 'object',
            properties,
            ...(required.length > 0 ? { required } : {}),
            additionalProperties: false,
        };
    }

    private asText(value: unknown): string {
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        return '';
    }
}
