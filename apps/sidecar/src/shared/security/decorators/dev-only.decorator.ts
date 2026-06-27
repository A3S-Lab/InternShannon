import { applyDecorators, UseGuards } from '@nestjs/common';
import { DevOnlyGuard } from '../guards/dev-only.guard';

/**
 * Development Mode Only Decorator
 *
 * AOP-style decorator that restricts endpoint access to development mode only.
 * When applied, the endpoint will throw DevModeOnlyException in production.
 *
 * @example
 * ```typescript
 * @Post('dev-diagnostics')
 * @DevOnly()
 * async getDevDiagnostics(): Promise<DevDiagnosticsDto> {
 *   // ...
 * }
 * ```
 */
export function DevOnly(): MethodDecorator & ClassDecorator {
    return applyDecorators(UseGuards(DevOnlyGuard));
}
