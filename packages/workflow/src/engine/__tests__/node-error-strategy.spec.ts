import { resolveNodeErrorDefaultOutput, resolveNodeErrorStrategy } from '../node-error-strategy';

describe('resolveNodeErrorStrategy', () => {
    it("defaults to 'fail' when unset / unknown / non-object", () => {
        expect(resolveNodeErrorStrategy(undefined)).toBe('fail');
        expect(resolveNodeErrorStrategy({})).toBe('fail');
        expect(resolveNodeErrorStrategy({ errorStrategy: 'nope' })).toBe('fail');
        expect(resolveNodeErrorStrategy('x')).toBe('fail');
    });

    it('reads the configured strategy', () => {
        expect(resolveNodeErrorStrategy({ errorStrategy: 'default' })).toBe('default');
        expect(resolveNodeErrorStrategy({ errorStrategy: 'continue' })).toBe('continue');
    });
});

describe('resolveNodeErrorDefaultOutput', () => {
    it('returns the configured default object', () => {
        expect(resolveNodeErrorDefaultOutput({ errorDefaultValue: { a: 1 } })).toEqual({ a: 1 });
        expect(resolveNodeErrorDefaultOutput({ defaultOutput: { b: 2 } })).toEqual({ b: 2 });
    });

    it('returns empty for missing / non-object defaults', () => {
        expect(resolveNodeErrorDefaultOutput(undefined)).toEqual({});
        expect(resolveNodeErrorDefaultOutput({})).toEqual({});
        expect(resolveNodeErrorDefaultOutput({ errorDefaultValue: 'x' })).toEqual({});
    });
});
