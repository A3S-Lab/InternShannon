import { Injectable, Logger } from '@nestjs/common';
import { LoopController } from '../domain/services/loop-controller.interface';

/**
 * Decoupled registry for LoopControllers (review: avoid LoopModule↔feature-module import cycles).
 *
 * Feature modules (assets/runtime/...) own their LoopController and self-register here in
 * onModuleInit; the LoopRunDriver (LoopModule) pulls from here. Both sides depend only on this
 * @Global registry, never on each other — so a knowledge/ops controller living in AssetsModule
 * reaches the driver without either module importing the other.
 *
 * Keyed by `kind` (one controller per loop kind). Change to a multimap if a kind needs several.
 */
@Injectable()
export class LoopControllerRegistry {
    private readonly logger = new Logger(LoopControllerRegistry.name);
    private readonly controllers = new Map<string, LoopController>();

    register(controller: LoopController): void {
        if (this.controllers.has(controller.kind)) {
            this.logger.warn(`LoopController kind=${controller.kind} already registered; overwriting`);
        }
        this.controllers.set(controller.kind, controller);
        this.logger.log(`Registered LoopController kind=${controller.kind} lane=${controller.laneId}`);
    }

    all(): LoopController[] {
        return Array.from(this.controllers.values());
    }

    get(kind: string): LoopController | undefined {
        return this.controllers.get(kind);
    }
}
