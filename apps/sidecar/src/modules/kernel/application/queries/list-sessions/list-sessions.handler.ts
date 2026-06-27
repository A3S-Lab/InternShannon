import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { IKernelService, KERNEL_SERVICE } from '../../../domain/services/kernel-service.interface';
import { ListSessionsQuery } from './list-sessions.query';

@QueryHandler(ListSessionsQuery)
export class ListSessionsHandler implements IQueryHandler<ListSessionsQuery> {
    constructor(@Inject(KERNEL_SERVICE) private readonly kernelService: IKernelService) {}

    async execute(query: ListSessionsQuery) {
        return this.kernelService.getUserSessions(
            query.userId,
            query.limit,
            query.offset,
            query.includeAllUsers,
            query.conversationalOnly,
        );
    }
}
