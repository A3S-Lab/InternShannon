import { Injectable, Logger } from '@nestjs/common';
import type { LoopSpec, LoopSpecKey, LoopSpecProvider } from '../domain/services/loop-spec.interface';

/**
 * Decoupled registry for read-only LoopSpec models — mirrors LoopControllerRegistry (and avoids the
 * cross-module multi-provider aggregation problem). Each spec-providing LoopController self-registers
 * here in onModuleInit (it already self-registers into LoopControllerRegistry next to it); a controller
 * hosting two run modes registers both specs. Both this registry and the controllers depend only on the
 * @Global LoopRegistryModule, never on each other.
 *
 * The LOOP_SPEC token in the domain interface remains the typed contract each provider implements
 * (loopSpec()); registration funnels through register() so the registry owns aggregation/dedup.
 */
@Injectable()
export class LoopSpecRegistry {
    private readonly logger = new Logger(LoopSpecRegistry.name);
    private readonly specs = new Map<LoopSpecKey, LoopSpec>();

    /** Register one provider's spec(s) (array when the controller hosts multiple run modes). */
    register(provider: LoopSpecProvider): void {
        const result = provider.loopSpec();
        for (const spec of Array.isArray(result) ? result : [result]) {
            if (this.specs.has(spec.key)) {
                this.logger.warn(`LoopSpec key=${spec.key} already registered; overwriting`);
            }
            this.specs.set(spec.key, spec);
        }
    }

    list(): LoopSpec[] {
        return Array.from(this.specs.values());
    }

    get(key: string): LoopSpec | undefined {
        return this.specs.get(key as LoopSpecKey);
    }
}
