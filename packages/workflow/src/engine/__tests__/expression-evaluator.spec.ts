import { ExpressionEvaluator } from '../expression-evaluator';

describe('ExpressionEvaluator — AST cache correctness', () => {
    it('reuses a cached AST but applies the FRESH context each call (no stale results)', () => {
        const evaluator = new ExpressionEvaluator();
        const expr = 'item.price > 10';
        // Same expression string → same cached AST, but each call must reflect its own context.
        expect(evaluator.evaluate(expr, { item: { price: 20 } })).toBe(true);
        expect(evaluator.evaluate(expr, { item: { price: 5 } })).toBe(false);
        expect(evaluator.evaluate(expr, { item: { price: 11 } })).toBe(true);
    });

    it('arithmetic is stable across repeated evaluations of the same expression', () => {
        const evaluator = new ExpressionEvaluator();
        for (let i = 0; i < 4; i++) {
            expect(evaluator.evaluate('a + b * 2', { a: 1, b: i })).toBe(1 + i * 2);
        }
    });

    it('cached evaluation never throws and stays correct after a context shape change', () => {
        const evaluator = new ExpressionEvaluator();
        expect(evaluator.evaluate('a.b', { a: { b: 7 } })).toBe(7);
        // Same expression, missing path next call — must not throw or return the prior value.
        expect(evaluator.evaluate('a.b', {})).not.toBe(7);
    });
});
