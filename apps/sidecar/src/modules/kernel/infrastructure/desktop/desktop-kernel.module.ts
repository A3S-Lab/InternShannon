import { Module } from '@nestjs/common';
import { SESSION_REPOSITORY } from '@/modules/kernel/domain/repositories/session.repository.interface';
import { MESSAGE_REPOSITORY } from '@/modules/kernel/domain/repositories/message.repository.interface';
import { KERNEL_SERVICE } from '@/modules/kernel/domain/services/kernel-service.interface';
import { DesktopSessionRepository } from './repositories/desktop-session.repository';
import { DesktopMessageRepository } from './repositories/desktop-message.repository';
import { DesktopKernelService } from './services/desktop-kernel.service';

@Module({
    providers: [
        DesktopSessionRepository,
        DesktopMessageRepository,
        {
            provide: SESSION_REPOSITORY,
            useExisting: DesktopSessionRepository,
        },
        {
            provide: MESSAGE_REPOSITORY,
            useExisting: DesktopMessageRepository,
        },
        {
            provide: KERNEL_SERVICE,
            useClass: DesktopKernelService,
        },
    ],
    exports: [SESSION_REPOSITORY, MESSAGE_REPOSITORY, KERNEL_SERVICE],
})
export class DesktopKernelModule {}
