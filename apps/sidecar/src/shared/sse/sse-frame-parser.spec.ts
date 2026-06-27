import { parseSseFrame, splitSseFrames } from './sse-frame-parser';

describe('parseSseFrame', () => {
    it('parses event + JSON data', () => {
        expect(parseSseFrame('event: result\ndata: {"status":"ok"}')).toEqual({
            type: 'result',
            data: { status: 'ok' },
        });
    });

    it('defaults event to "message" when only data is present', () => {
        expect(parseSseFrame('data: 42')).toEqual({ type: 'message', data: 42 });
    });

    it('joins multi-line data with newline', () => {
        const parsed = parseSseFrame('event: text\ndata: line-1\ndata: line-2');
        expect(parsed).toEqual({ type: 'text', data: 'line-1\nline-2' });
    });

    it('returns string body verbatim when data is not JSON', () => {
        expect(parseSseFrame('event: log\ndata: hello world')).toEqual({
            type: 'log',
            data: 'hello world',
        });
    });

    it('ignores comment lines (heartbeat)', () => {
        expect(parseSseFrame(': heartbeat\nevent: ping\ndata: 1')).toEqual({
            type: 'ping',
            data: 1,
        });
    });

    it('returns null when no data line is present', () => {
        expect(parseSseFrame(': just a comment\nevent: nothing')).toBeNull();
    });
});

describe('splitSseFrames', () => {
    it('splits complete frames and keeps trailing remainder', () => {
        const buffer = 'event: a\ndata: 1\n\nevent: b\ndata: 2\n\nevent: c\ndata: incomplete';
        const { frames, remainder } = splitSseFrames(buffer);
        expect(frames).toEqual(['event: a\ndata: 1', 'event: b\ndata: 2']);
        expect(remainder).toBe('event: c\ndata: incomplete');
    });

    it('returns empty frames and full remainder when no separator', () => {
        const { frames, remainder } = splitSseFrames('event: x\ndata: 1');
        expect(frames).toEqual([]);
        expect(remainder).toBe('event: x\ndata: 1');
    });

    it('handles back-to-back empty frames gracefully', () => {
        const { frames, remainder } = splitSseFrames('event: a\ndata: 1\n\n\n\nevent: b\ndata: 2\n\n');
        expect(frames).toEqual(['event: a\ndata: 1', '', 'event: b\ndata: 2']);
        expect(remainder).toBe('');
    });
});
