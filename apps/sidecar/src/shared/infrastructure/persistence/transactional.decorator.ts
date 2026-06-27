import { IUnitOfWork } from './unit-of-work.interface';
import { UNIT_OF_WORK } from './unit-of-work.token';

// ============================================================================
// Transactional Decorator
// Wraps a method execution within a Unit of Work transaction
// ============================================================================

/**
 * Decorator that wraps method execution within a transaction.
 * The method must be in a class that injects IUnitOfWork.
 *
 * Usage:
 * ```
 * @Transactional()
 * async execute(command: MyCommand): Promise<Result> {
 *   // All operations within this method are transactional
 * }
 * ```
 */
export function Transactional() {
    return (_target: object, _propertyKey: string, descriptor: PropertyDescriptor) => {
        const originalMethod = descriptor.value;

        descriptor.value = async function (...args: unknown[]) {
            const unitOfWork = (this as { [key: string]: unknown })[String(UNIT_OF_WORK)] as IUnitOfWork;

            if (!unitOfWork) {
                throw new Error(`Transactional decorator requires ${String(UNIT_OF_WORK)} to be injected`);
            }

            await unitOfWork.start();
            try {
                const result = await originalMethod.apply(this, args);
                await unitOfWork.commit();
                return result;
            } catch (error) {
                await unitOfWork.rollback();
                throw error;
            }
        };

        return descriptor;
    };
}
