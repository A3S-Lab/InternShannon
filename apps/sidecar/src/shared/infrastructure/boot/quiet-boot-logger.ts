import { ConsoleLogger, LogLevel } from '@nestjs/common';

/**
 * Boot logger that drops Nest's per-route registration noise. The
 * `RouterExplorer` context emits ~one line per HTTP route during
 * `app.listen()` — for a project with ~900 routes that costs ~150-300ms of
 * stdout I/O plus visual noise that buries real diagnostic output.
 *
 * Enable via `QUIET_BOOT_LOGS=true` (or leave on by default in production).
 * All other contexts and log levels pass through unchanged.
 */
const NOISY_CONTEXTS = new Set(['RouterExplorer', 'RoutesResolver']);

export class QuietBootLogger extends ConsoleLogger {
    private readonly enabled: boolean;

    constructor(logLevels: LogLevel[]) {
        super('Bootstrap', { logLevels });
        this.enabled = (process.env.QUIET_BOOT_LOGS ?? 'true').toLowerCase() !== 'false';
    }

    log(message: unknown, context?: string): void {
        if (this.enabled && context && NOISY_CONTEXTS.has(context)) return;
        super.log(message, context);
    }
}
