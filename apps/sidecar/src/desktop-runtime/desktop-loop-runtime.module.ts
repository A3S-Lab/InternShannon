import { Module } from '@nestjs/common';
import { DesktopLoopRunRepository } from '@/infrastructure/desktop/loop/desktop-loop-run.repository';
import { DevLoopRunService } from '@/modules/loop/application/dev-loop-run.service';
import { EVENT_BUS } from '@/modules/loop/domain/events/event-bus.interface';
import { LOOP_RUN_REPOSITORY } from '@/modules/loop/domain/repositories/loop-run.repository.interface';
import { InProcessEventBus } from '@/modules/loop/application/events/in-process-event-bus';
import { LoopSpecController } from '@/modules/loop/presentation/loop-spec.controller';
import { DevLoopRunController } from '@/modules/loop/presentation/dev-loop-run.controller';
import { DevLoopController } from '@/modules/loop/loops/dev/dev-loop.controller';
import { LoopRegistryModule } from '@/modules/loop/loop-registry.module';

@Module({
    imports: [LoopRegistryModule],
    controllers: [LoopSpecController, DevLoopRunController],
    providers: [
        {
            provide: LOOP_RUN_REPOSITORY,
            useClass: DesktopLoopRunRepository,
        },
        { provide: EVENT_BUS, useClass: InProcessEventBus },
        DevLoopRunService,
        DevLoopController,
    ],
    exports: [LOOP_RUN_REPOSITORY, DevLoopRunService, EVENT_BUS, LoopRegistryModule],
})
export class DesktopLoopRuntimeModule {}
