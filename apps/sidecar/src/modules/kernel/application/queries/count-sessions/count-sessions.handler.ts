import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { IKernelService, KERNEL_SERVICE } from '../../../domain/services/kernel-service.interface';
import { CountSessionsQuery } from './count-sessions.query';

@QueryHandler(CountSessionsQuery)
export class CountSessionsHandler implements IQueryHandler<CountSessionsQuery> {
    constructor(@Inject(KERNEL_SERVICE) private readonly kernelService: IKernelService) {}

    async execute(query: CountSessionsQuery): Promise<number> {
        return this.kernelService.countUserSessions(query.userId, query.includeAllUsers, query.conversationalOnly);
    }
}
