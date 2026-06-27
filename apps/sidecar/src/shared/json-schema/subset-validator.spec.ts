import { metaCheckSubset, validate } from './subset-validator';

describe('JsonSchemaSubsetValidator', () => {
    describe('metaCheckSubset', () => {
        it('accepts a valid object schema with all subset keywords', () => {
            const result = metaCheckSubset({
                type: 'object',
                properties: {
                    name: { type: 'string', enum: ['alice', 'bob'] },
                    age: { type: 'integer' },
                    tags: { type: 'array', items: { type: 'string' } },
                },
                required: ['name'],
                additionalProperties: false,
            });
            expect(result).toEqual({ valid: true, errors: [] });
        });

        it('rejects forbidden keywords (oneOf, anyOf, allOf, format, $ref to external)', () => {
            const result = metaCheckSubset({
                type: 'object',
                properties: {
                    x: { oneOf: [{ type: 'string' }, { type: 'number' }] },
                },
            } as unknown);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('oneOf'))).toBe(true);
        });

        it('rejects type outside subset (e.g. "any")', () => {
            const result = metaCheckSubset({ type: 'any' } as unknown);
            expect(result.valid).toBe(false);
        });

        it('accepts internal $defs $ref but rejects remote $ref', () => {
            const okay = metaCheckSubset({
                type: 'object',
                $defs: {
                    Money: { type: 'object', properties: { amount: { type: 'number' } } },
                },
                properties: {
                    salary: { $ref: '#/$defs/Money' },
                },
            });
            expect(okay.valid).toBe(true);

            const remote = metaCheckSubset({
                type: 'object',
                properties: {
                    x: { $ref: 'https://example.com/schemas/Money.json' },
                },
            });
            expect(remote.valid).toBe(false);
        });

        it('rejects additionalProperties as a sub-schema (only boolean allowed)', () => {
            const result = metaCheckSubset({
                type: 'object',
                additionalProperties: { type: 'string' },
            } as unknown);
            expect(result.valid).toBe(false);
        });
    });

    describe('validate', () => {
        const schema = {
            type: 'object',
            properties: {
                name: { type: 'string' },
                age: { type: 'integer' },
                tags: { type: 'array', items: { type: 'string' } },
                role: { type: 'string', enum: ['admin', 'user'] },
            },
            required: ['name', 'role'],
            additionalProperties: false,
        };

        it('passes valid data', () => {
            const result = validate(schema, { name: 'alice', role: 'admin', age: 30, tags: ['a', 'b'] });
            expect(result.valid).toBe(true);
        });

        it('reports missing required fields', () => {
            const result = validate(schema, { age: 30 });
            expect(result.valid).toBe(false);
            const paths = result.errors.map(e => e.path);
            expect(paths).toContain('#.name');
            expect(paths).toContain('#.role');
        });

        it('reports type mismatch', () => {
            const result = validate(schema, { name: 'alice', role: 'admin', age: 'thirty' });
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.path === '#.age' && /expected integer/.test(e.message))).toBe(true);
        });

        it('reports additionalProperties violation', () => {
            const result = validate(schema, { name: 'alice', role: 'admin', extra: 'oops' });
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.path === '#.extra')).toBe(true);
        });

        it('reports enum violation', () => {
            const result = validate(schema, { name: 'alice', role: 'banker' });
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.path === '#.role' && /enum/.test(e.message))).toBe(true);
        });

        it('resolves $ref against $defs', () => {
            const withRef = {
                type: 'object',
                $defs: {
                    Money: {
                        type: 'object',
                        properties: { amount: { type: 'number' }, currency: { type: 'string' } },
                        required: ['amount'],
                    },
                },
                properties: { salary: { $ref: '#/$defs/Money' } },
                required: ['salary'],
            };
            expect(validate(withRef, { salary: { amount: 1000 } }).valid).toBe(true);
            expect(validate(withRef, { salary: { currency: 'CNY' } }).valid).toBe(false);
        });
    });
});
