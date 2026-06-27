import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { IKernelService, KERNEL_SERVICE } from '../../../domain/services/kernel-service.interface';
import { KernelSessionRuntimeAccessService } from '../../kernel-session-runtime-access.service';
import { EndSessionCommand } from './end-session.command';

@CommandHandler(EndSessionCommand)
export class EndSessionHandler implements ICommandHandler<EndSessionCommand> {
    constructor(
        @Inject(KERNEL_SERVICE) private readonly kernelService: IKernelService,
        private readonly runtimeAccess: KernelSessionRuntimeAccessService,
    ) {}

    async execute(command: EndSessionCommand) {
        this.runtimeAccess.closeActive(command.sessionId);
        return this.kernelService.endSession(command.sessionId);
    }
}
