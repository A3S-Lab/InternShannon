import { Injectable, Logger } from '@nestjs/common';
import type { Asset } from '@/modules/assets/domain/entities/asset.entity';

/**
 * Seam between the dev:diagnose LoopController (in LoopModule) and the heavy AssetDiagnoseRunner
 * (in bootstrap/builtin-assets, which depends on kernel/assets). The loop module MUST NOT import the
 * runner directly — that would form a cycle (assets/kernel already reach into loop-adjacent code) and
 * pull the kernel agent stack into the loop layer. So the runner is registered THROUGH this @Global
 * registry at boot, exactly mirroring `AssetDevelopmentBoardService.registerDiagnoseRunner`:
 *
 *   - BuiltinAssetsBootstrap.onModuleInit → registry.register(runnerHook)   (bootstrap → loop)
 *   - DiagnoseLoopController.step() → registry.run(asset, mode, options)     (loop → runner)
 *
 * The hook mirrors `AssetDiagnoseRunner.runDiagnose` so the loop's Action delegates ONE long step
 * (variant A) to the existing runner without re-implementing diagnosis. The board already drives this
 * runner via its own hook; once the board hands diagnosis to a loop_run (Phase 1) the loop is the only
 * driver, so the runner's per-asset guard + `hasActiveRun('dev', assetId)` keep the
 * two paths from ever running the same asset's diagnosis concurrently.
 */

/** Live worker-progress callback the runner fires on each `generate_object` payload. */
export type DiagnoseLoopProgress = (event: { completed: number; total: number; attempt?: number }) => void | Promise<void>;

/** Options forwarded to the runner — a strict subset of AssetDiagnoseRunnerOptions the loop needs. */
export interface DiagnoseLoopRunOptions {
    userId: string;
    /** Bypass idempotent reuse (operator-driven re-diagnose / board "重新诊断"). */
    forceRerun?: boolean;
    /** Interactive optimize: persist patches but leave them pending (no auto-PR). */
    deferRemediation?: boolean;
    /** Tag the kernel session so existing board write-back keys off boardId/requirementId. */
    sessionMetadata?: Record<string, unknown>;
    /** Fired once a kernel session is created (board attaches it to the lane card). */
    onSessionCreated?: (sessionId: string) => void | Promise<void>;
    /** Fired per worker completion (board lane chip progress). */
    onProgress?: DiagnoseLoopProgress;
}

/** Per-worker outcome — the gate the loop reads to decide succeeded/failed (mirrors DiagnoseScopeStatus). */
export interface DiagnoseLoopScopeStatus {
    succeeded: number;
    failed: number;
    total: number;
    details: Array<{ name: string; label: string; status: 'completed' | 'failed'; error?: string }>;
}

/** Minimal result the loop needs back from the runner (subset of RunDiagnoseResult). */
export interface DiagnoseLoopRunResult {
    report: { id: string };
    sessionId?: string;
    findingCount: number;
    patchCount: number;
    scopeStatus?: DiagnoseLoopScopeStatus;
    reused?: boolean;
}

/** The registered runner callback — mirrors `AssetDiagnoseRunner.runDiagnose`'s shape. */
export type DiagnoseRunnerHook = (
    asset: Asset,
    mode: 'diagnose' | 'optimize',
    options: DiagnoseLoopRunOptions,
) => Promise<DiagnoseLoopRunResult>;

/**
 * @Global registry (provided by LoopRegistryModule). Same decoupling contract as
 * LoopControllerRegistry: the loop layer and the bootstrap layer both depend only on this token,
 * never on each other, so no import cycle forms.
 */
@Injectable()
export class DiagnoseRunnerRegistry {
    private readonly logger = new Logger(DiagnoseRunnerRegistry.name);
    private hook: DiagnoseRunnerHook | null = null;

    /** Called once by BuiltinAssetsBootstrap.onModuleInit (cloud only). */
    register(hook: DiagnoseRunnerHook): void {
        if (this.hook) {
            this.logger.warn('Diagnose runner already registered; overwriting');
        }
        this.hook = hook;
        this.logger.log('Diagnose runner registered with the dev:diagnose loop');
    }

    /** True once the runner is wired — the loop step fails honestly otherwise (never silently). */
    isRegistered(): boolean {
        return this.hook !== null;
    }

    /** Invoke the registered runner. Throws if unregistered (BuiltinAssetsModule not loaded). */
    run(asset: Asset, mode: 'diagnose' | 'optimize', options: DiagnoseLoopRunOptions): Promise<DiagnoseLoopRunResult> {
        if (!this.hook) {
            throw new Error('诊断 runner 未注册(BuiltinAssetsModule 未加载?)');
        }
        return this.hook(asset, mode, options);
    }
}
