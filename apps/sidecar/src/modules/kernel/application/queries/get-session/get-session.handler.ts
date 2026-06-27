import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { IKernelService, KERNEL_SERVICE } from '../../../domain/services/kernel-service.interface';
import { GetSessionQuery } from './get-session.query';

@QueryHandler(GetSessionQuery)
export class GetSessionHandler implements IQueryHandler<GetSessionQuery> {
    constructor(@Inject(KERNEL_SERVICE) private readonly kernelService: IKernelService) {}

    async execute(query: GetSessionQuery) {
        return this.kernelService.getSession(query.sessionId);
    }
}
