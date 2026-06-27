import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { BadRequestException, GlobalErrorFilter, StatusCode, getStatusMessage } from '../../../common/errors';

export class DomainException extends Error {
    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
        Error.captureStackTrace?.(this, this.constructor);
    }
}

@Catch(DomainException)
export class DomainExceptionFilter implements ExceptionFilter {
    private readonly delegate = new GlobalErrorFilter();

    catch(exception: DomainException, host: ArgumentsHost) {
        this.delegate.catch(
            new BadRequestException(getStatusMessage(StatusCode.BAD_REQUEST), {
                type: exception.name,
                message: exception.message,
            }),
            host,
        );
    }
}
