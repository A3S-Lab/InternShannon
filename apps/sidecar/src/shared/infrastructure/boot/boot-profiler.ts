import { Logger } from '@nestjs/common';

/**
 * Lightweight startup profiler. Lifecycle hooks call `time()` to wrap their
 * work; on completion the elapsed ms is logged so an operator scrolling the
 * boot log can quickly spot which hook owns a slow startup. The slow-threshold
 * is intentionally tight — boot is single-shot and we want even ~200ms
 * regressions to stand out.
 *
 * Usage:
 *
 *   async onApplicationBootstrap() {
 *       await BootProfiler.time('MyModule.bootstrap', () => this.actualBootstrap());
 *   }
 */
export class BootProfiler {
    private static readonly logger = new Logger('BootProfiler');
    private static readonly SLOW_MS = Number(process.env.BOOT_PROFILER_SLOW_MS || 200);

    static async time<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
        const startedAt = Date.now();
        try {
            return await fn();
        } finally {
            const elapsed = Date.now() - startedAt;
            if (elapsed >= BootProfiler.SLOW_MS) {
                BootProfiler.logger.log(`[slow] ${label} took ${elapsed}ms`);
            } else {
                BootProfiler.logger.debug(`${label} took ${elapsed}ms`);
            }
        }
    }

    /**
     * Fire-and-forget a background task spawned during startup. Logs failures
     * and timing so backgrounded boot work doesn't disappear into silent
     * unhandled-rejection warnings.
     */
    static background(label: string, fn: () => Promise<unknown>): void {
        const startedAt = Date.now();
        BootProfiler.logger.debug(`[bg] ${label} started`);
        fn()
            .then(() => {
                const elapsed = Date.now() - startedAt;
                BootProfiler.logger.log(`[bg] ${label} done in ${elapsed}ms`);
            })
            .catch(error => {
                const elapsed = Date.now() - startedAt;
                BootProfiler.logger.error(
                    `[bg] ${label} failed after ${elapsed}ms: ${error instanceof Error ? error.message : String(error)}`,
                    error instanceof Error ? error.stack : undefined,
                );
            });
    }
}
