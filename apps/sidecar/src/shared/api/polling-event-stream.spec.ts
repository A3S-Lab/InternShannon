import type { MessageEvent } from '@nestjs/common';
import { pollingEventStream } from './polling-event-stream';

/**
 * 重点锁住「独立 keepalive 在 poll tick 阻塞时仍发帧」—— 这是修开放平台工作流 SSE
 * 运行中偶发断连(慢 tick 期间无字节穿透 → 网关 idle 切断)的核心。用 fake timers
 * 驱动 RxJS interval。
 */
describe('pollingEventStream', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    function baseOptions<T extends { id: string }>(overrides: Partial<Parameters<typeof pollingEventStream<T>>[0]>) {
        return {
            pollIntervalMs: 1000,
            fetch: async () => [] as T[],
            itemId: (i: T) => i.id,
            advanceCursor: (i: T) => i.id,
            toItemEvent: (i: T) => ({ type: 'item', data: i.id }) as MessageEvent,
            toHeartbeat: () => ({ type: 'heartbeat', data: 'hb' }) as MessageEvent,
            toError: (e: unknown) => ({ type: 'error', data: String(e) }) as MessageEvent,
            ...overrides,
        };
    }

    it('emits item events fetched from the source', async () => {
        jest.useFakeTimers();
        const events: MessageEvent[] = [];
        let served = false;
        const stream = pollingEventStream<{ id: string }>(
            baseOptions<{ id: string }>({
                fetch: async () => {
                    if (served) return [];
                    served = true;
                    return [{ id: 'a' }];
                },
            }),
        );
        const sub = stream.subscribe(e => events.push(e));
        await jest.advanceTimersByTimeAsync(1500);
        expect(events.some(e => e.type === 'item' && e.data === 'a')).toBe(true);
        sub.unsubscribe();
    });

    it('keepalive heartbeats keep flowing while a poll tick is blocked (idle-timeout 防线)', async () => {
        jest.useFakeTimers();
        const events: MessageEvent[] = [];
        const stream = pollingEventStream<{ id: string }>(
            baseOptions<{ id: string }>({
                // fetch 永不 resolve → tick 卡在 concatMap;若没有独立 keepalive,整条流将
                // 在阻塞期间一个字节都不发 → 被网关 idle timeout 切断(用户报的运行中断连)。
                fetch: () => new Promise<{ id: string }[]>(() => {}),
            }),
        );
        const sub = stream.subscribe(e => events.push(e));
        // KEEPALIVE_INTERVAL_MS=10s;推进 25s → 独立 keepalive 应在 10s/20s 各发一帧。
        await jest.advanceTimersByTimeAsync(25_000);
        const heartbeats = events.filter(e => e.type === 'heartbeat');
        expect(heartbeats.length).toBeGreaterThanOrEqual(2);
        sub.unsubscribe();
    });

    it('stops after a terminal item + sentinel', async () => {
        jest.useFakeTimers();
        const events: MessageEvent[] = [];
        let completed = false;
        const stream = pollingEventStream<{ id: string }>(
            baseOptions<{ id: string }>({
                fetch: async () => [{ id: 'final' }],
                isTerminal: i => i.id === 'final',
                toTerminalEvent: () => ({ type: 'complete', data: 'done' }) as MessageEvent,
            }),
        );
        const sub = stream.subscribe({ next: e => events.push(e), complete: () => (completed = true) });
        await jest.advanceTimersByTimeAsync(2000);
        expect(events.some(e => e.type === 'item' && e.data === 'final')).toBe(true);
        expect(events.some(e => e.type === 'complete')).toBe(true);
        expect(completed).toBe(true);
        sub.unsubscribe();
    });
});
