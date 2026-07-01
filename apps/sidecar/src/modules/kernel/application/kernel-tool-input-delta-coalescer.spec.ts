import { KernelToolInputDeltaCoalescer } from './kernel-tool-input-delta-coalescer';

describe('KernelToolInputDeltaCoalescer', () => {
    it('holds small adjacent input deltas until an explicit flush', () => {
        const coalescer = new KernelToolInputDeltaCoalescer({ maxPendingBytes: 100, maxPendingMs: 1000 });

        expect(coalescer.push('{"path"', 0)).toBeNull();
        expect(coalescer.push(':"a.ts"', 10)).toBeNull();
        expect(coalescer.flush()).toBe('{"path":"a.ts"');
        expect(coalescer.flush()).toBeNull();
    });

    it('flushes when pending input exceeds the byte threshold', () => {
        const coalescer = new KernelToolInputDeltaCoalescer({ maxPendingBytes: 8, maxPendingMs: 1000 });

        expect(coalescer.push('1234', 0)).toBeNull();
        expect(coalescer.push('5678', 10)).toBe('12345678');
        expect(coalescer.flush()).toBeNull();
    });

    it('flushes when pending input has waited past the time threshold', () => {
        const coalescer = new KernelToolInputDeltaCoalescer({ maxPendingBytes: 100, maxPendingMs: 250 });

        expect(coalescer.push('abc', 1000)).toBeNull();
        expect(coalescer.push('def', 1249)).toBeNull();
        expect(coalescer.push('ghi', 1250)).toBe('abcdefghi');
    });
});
