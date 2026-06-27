import { IUnitOfWork } from './unit-of-work.interface';

export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK') as symbol & {
    readonly IUnitOfWork: IUnitOfWork;
};
