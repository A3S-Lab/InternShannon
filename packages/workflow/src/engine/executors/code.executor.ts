import { Logger } from '@nestjs/common';
import { BaseNodeExecutor, NodeExecutorResult } from './base.executor';
import { ExecutionContext } from '../execution-context';
import { WorkflowNode, WorkflowNodeType, CodeNodeData } from '../../domain/value-objects';
import { CancellationToken } from '../cancellation-token';
import { CliSrtCodeRunner, type CodeSandboxPolicy, type SrtCodeRunner } from './srt-code-runner';

/**
 * Code Node Executor
 *
 * Executes user-authored JavaScript inside Anthropic Sandbox Runtime (srt),
 * which puts the child process under OS-level filesystem + network restrictions
 * (`sandbox-exec` on macOS, `bubblewrap` on Linux). User code thus cannot read
 * ~/.ssh, exfiltrate over network, or write outside the per-spawn tmp dir
 * unless the node's sandboxPolicy explicitly grants those holes.
 *
 * Sandbox toggle (`A3S_CODE_SANDBOX` env):
 *   - `srt` (default in production) — require srt, fail when unavailable
 *   - `auto` — try srt, fall back to unsandboxed AsyncFunction with a warning
 *     when srt is missing (intended for dev / Windows / CI without srt installed)
 *   - `none` — always run unsandboxed (NOT recommended; keeps original behavior)
 */
export class CodeNodeExecutor extends BaseNodeExecutor {
    readonly type = WorkflowNodeType.Code;
    private readonly logger = new Logger(CodeNodeExecutor.name);
    private readonly runner: SrtCodeRunner;

    constructor(runner?: SrtCodeRunner) {
        super();
        this.runner = runner ?? new CliSrtCodeRunner();
    }

    protected async doExecute(
        _context: ExecutionContext,
        node: WorkflowNode,
        inputs: Record<string, unknown>,
        cancellationToken?: CancellationToken,
    ): Promise<NodeExecutorResult> {
        const data = node.data as CodeNodeData;

        if (!data.code) {
            throw new Error(`Code node ${node.id}: code content is required`);
        }
        const language = data.language || 'javascript';
        if (language !== 'javascript') {
            throw new Error(`Unsupported code language: ${language}`);
        }

        const mode = this.resolveSandboxMode();
        const policy = this.resolvePolicy(node);

        if (mode === 'none') {
            this.logger.warn(`Code node ${node.id}: running unsandboxed (A3S_CODE_SANDBOX=none). User code has full host access.`);
            return this.executeUnsandboxed(data.code, inputs, node.id);
        }

        if (this.runner.isAvailable()) {
            try {
                return await this.runner.run({
                    code: data.code,
                    params: inputs,
                    policy,
                    cancellationToken,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(`Code execution failed: ${message}`);
            }
        }

        if (mode === 'auto') {
            this.logger.warn(
                `Code node ${node.id}: srt unavailable, falling back to unsandboxed AsyncFunction (A3S_CODE_SANDBOX=auto). `
                + 'Install Anthropic Sandbox Runtime in production.',
            );
            return this.executeUnsandboxed(data.code, inputs, node.id);
        }

        // mode === 'srt' (default) and runner unavailable: surface a clear error
        // rather than silently degrading.
        throw new Error(
            `Code node ${node.id}: srt sandbox required but binary not found in PATH. `
            + 'Install via `npm install -g @anthropic-ai/sandbox-runtime`, '
            + 'or set A3S_CODE_SANDBOX=auto to allow unsandboxed fallback, '
            + 'or A3S_CODE_SANDBOX=none to disable sandboxing entirely.',
        );
    }

    private resolveSandboxMode(): 'srt' | 'auto' | 'none' {
        const raw = (process.env.A3S_CODE_SANDBOX ?? '').trim().toLowerCase();
        if (raw === 'auto') return 'auto';
        if (raw === 'none' || raw === 'off' || raw === 'false') return 'none';
        return 'srt';
    }

    private resolvePolicy(node: WorkflowNode): CodeSandboxPolicy | undefined {
        const data = node.data as Record<string, unknown> | undefined;
        const candidate = data?.sandboxPolicy;
        if (!candidate || typeof candidate !== 'object') return undefined;
        return candidate as CodeSandboxPolicy;
    }

    /**
     * Legacy unsandboxed path — kept ONLY for the explicit `A3S_CODE_SANDBOX=none`
     * mode and as the `auto` mode fallback. Production deployments should never
     * hit this path. The wrapping is identical to the pre-srt implementation so
     * existing tests / workflows behave the same when sandboxing is off.
     */
    private async executeUnsandboxed(
        code: string,
        inputs: Record<string, unknown>,
        nodeId: string,
    ): Promise<NodeExecutorResult> {
        try {
            const sandbox = {
                console: {
                    log: (...args: unknown[]) => this.logger.log('[code]', ...args),
                    error: (...args: unknown[]) => this.logger.error('[code]', ...args),
                    warn: (...args: unknown[]) => this.logger.warn('[code]', ...args),
                },
                params: inputs,
            };

            const wrappedCode = `
'use strict';
let __result__;
${code}
if (typeof main === 'function') {
    __result__ = main({ params });
} else {
    throw new Error('main function is required');
}
return __result__;
`;

            const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
            const fn = new AsyncFunction('console', 'params', wrappedCode);
            const result = await fn(sandbox.console, sandbox.params);

            const outputs =
                result && typeof result === 'object' && !Array.isArray(result)
                    ? (result as Record<string, unknown>)
                    : { result };

            return { outputs };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Code execution failed (nodeId=${nodeId}): ${message}`);
        }
    }
}
