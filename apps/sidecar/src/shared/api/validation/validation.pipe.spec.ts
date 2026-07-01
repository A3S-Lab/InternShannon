import { BadRequestException } from '@nestjs/common';
import { IsInt, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { StatusCode } from '../../common/errors/error-codes';
import { createValidationPipe, formatValidationErrors } from './validation.pipe';

// Use @IsInt so a non-numeric string still fails under enableImplicitConversion
// (Number('abc') -> NaN), unlike @IsString which would accept coerced numbers.
class ChildDto {
    @IsInt()
    input!: number;
}

class ParentDto {
    @IsInt()
    count!: number;

    @ValidateNested()
    @Type(() => ChildDto)
    child!: ChildDto;
}

describe('formatValidationErrors', () => {
    it('flattens nested errors into dotted field paths with messages', () => {
        const formatted = formatValidationErrors([
            {
                property: 'name',
                constraints: { isString: 'name must be a string' },
            },
            {
                property: 'child',
                children: [
                    {
                        property: 'input',
                        constraints: { isString: 'input must be a string' },
                    },
                ],
            },
        ] as never);

        expect(formatted).toEqual([
            { field: 'name', messages: ['必须是字符串'] },
            { field: 'child.input', messages: ['必须是字符串'] },
        ]);
    });
});

describe('createValidationPipe exceptionFactory', () => {
    it('throws the unified validation contract with fieldErrors', async () => {
        const pipe = createValidationPipe();

        const invalid = { count: 'abc', child: { input: 'xyz' } };

        await expect(
            pipe.transform(invalid, { type: 'body', metatype: ParentDto }),
        ).rejects.toBeInstanceOf(BadRequestException);

        let captured: Record<string, unknown> | undefined;
        try {
            await pipe.transform(invalid, { type: 'body', metatype: ParentDto });
        } catch (err) {
            captured = (err as BadRequestException).getResponse() as Record<string, unknown>;
        }

        expect(captured?.status).toBe(StatusCode.VALIDATION_ERROR);
        expect(typeof captured?.message).toBe('string');
        expect(captured?.fieldErrors).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ field: 'count', messages: expect.any(Array) }),
                expect.objectContaining({ field: 'child.input', messages: expect.any(Array) }),
            ]),
        );
    });
});
