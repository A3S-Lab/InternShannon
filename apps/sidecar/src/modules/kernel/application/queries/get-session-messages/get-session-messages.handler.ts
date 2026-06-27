import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { IKernelService, KERNEL_SERVICE } from '../../../domain/services/kernel-service.interface';
import { GetSessionMessagesQuery } from './get-session-messages.query';

@QueryHandler(GetSessionMessagesQuery)
export class GetSessionMessagesHandler implements IQueryHandler<GetSessionMessagesQuery> {
    constructor(@Inject(KERNEL_SERVICE) private readonly kernelService: IKernelService) {}

    async execute(query: GetSessionMessagesQuery) {
        return this.kernelService.getSessionMessages(query.sessionId, query.limit, query.offset);
    }
}
