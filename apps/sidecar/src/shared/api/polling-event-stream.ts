import { MessageEvent } from '@nestjs/common';
import {
    Observable,
    Subject,
    catchError,
    concatMap,
    defer,
    finalize,
    from,
    interval,
    map,
    merge,
    mergeMap,
    of,
    startWith,
    takeUntil,
} from 'rxjs';

// 独立于 poll tick 的 SSE keepalive 节拍。某个 tick 的 beforeEvents(总览 6 查询)+ fetch
// 在高负载下可能阻塞数秒,而 concatMap 串行化 tick → 阻塞期间整条流不发任何字节 → 经
// a3s-gateway 等代理的 idle timeout 被切断(前端表现为运行中偶尔断连后重连)。这个独立
// 定时器无视 tick 阻塞、按固定节拍推送心跳帧维持连接。10s 远小于常见 SSE idle 超时。
const KEEPALIVE_INTERVAL_MS = 10_000;

export interface PollingEventStreamOptions<TItem> {
    pollIntervalMs: number;
    fetch: (cursor: string | undefined) => Promise<TItem[]>;
    itemId: (item: TItem) => string;
    advanceCursor: (item: TItem) => string;
    toItemEvent: (item: TItem) => MessageEvent;
    toHeartbeat: () => MessageEvent;
    toError: (error: unknown) => MessageEvent;
    // Optional synthetic events emitted before append-only items on each poll.
    beforeEvents?: () => Promise<MessageEvent[]>;
    // Optional access pre-check. Runs once before polling starts so a 403
    // surfaces before the client ever sees a heartbeat; per-tick re-checks are
    // intentionally NOT supported here — the previous per-tick version was a
    // copy-paste accident, not a security requirement.
    accessCheck?: () => Promise<void>;
    initialCursor?: string;
    /**
     * When set, the stream stops as soon as it emits an item satisfying this
     * predicate. Required to support a terminal sentinel — without it the
     * stream emits heartbeats forever even after the underlying workload is
     * done.
     *
     * The terminal item's own `toItemEvent` is still emitted FIRST so the
     * client sees the final state event before the close-signal event.
     */
    isTerminal?: (item: TItem) => boolean;
    /**
     * Synthetic event emitted right after a terminal item, before the stream
     * completes. Clients should treat it as "server says we're done, you may
     * stop processing now". Receives the terminal item so the event payload can
     * carry the final status without the client having to remember it from the
     * preceding item event.
     */
    toTerminalEvent?: (terminalItem: TItem) => MessageEvent;
    /**
     * Extra events to flush AFTER the terminal item but BEFORE the
     * `toTerminalEvent` sentinel. Without this hook, cached signatures in
     * callers may suppress the very last overview and clients can get stuck
     * on a stale running snapshot.
     */
    afterTerminalEvents?: (terminalItem: TItem) => Promise<MessageEvent[]>;
    /**
     * Per-item async hook. Runs once per fresh item AFTER `toItemEvent` is
     * appended to the outgoing batch. Lets callers attach a synthetic
     * "follow-up" event to a specific item type. Returning `[]` (or throwing
     * — errors are swallowed) is a no-op for that item.
     */
    afterItemEvents?: (item: TItem) => Promise<MessageEvent[]>;
}

/**
 * Polling-based SSE stream used for append-only event tables. Maintains a
 * `seen` set for at-least-once-style
 * deduplication and advances a `cursor` (usually `createdAt`) so subsequent
 * fetches only return newer rows.
 *
 * For non-event-list shapes (e.g. build log tail-by-length), write a separate
 * stream — forcing them through this helper would obscure the differences.
 */
export function pollingEventStream<TItem>(options: PollingEventStreamOptions<TItem>): Observable<MessageEvent> {
    const seen = new Set<string>();
    let cursor = options.initialCursor;
    // Subject + takeUntil pattern lets the inner tick signal "we just emitted
    // the terminal item + sentinel; please stop polling and close the SSE
    // connection". We can't just use takeWhile on the outer because terminal
    // detection happens INSIDE a tick — we want the terminal item event AND
    // the synthetic completion event to flush before unsubscribe.
    const terminate$ = new Subject<void>();

    // afterItemEvents 只对一批里的最后一条触发,而不是每条。某些 overview
    // 计算很贵;完成的执行初次订阅会一次性 replay 全部历史事件,逐条计算会让
    // replay 慢到 N×overview。每批只算最后一条的 follow-up: live 流每 tick
    // 1-2 条行为不变,bulk replay 提速 ~N 倍;终态最终快照由 afterTerminalEvents
    // 单独保证,不丢信息。
    const expandBatch = async (items: TItem[]): Promise<MessageEvent[]> => {
        const events = items.map(options.toItemEvent);
        if (items.length > 0 && options.afterItemEvents) {
            const followUps = await options.afterItemEvents(items[items.length - 1]).catch(() => [] as MessageEvent[]);
            events.push(...followUps);
        }
        return events;
    };

    const tick = () =>
        from(Promise.all([options.beforeEvents?.() ?? Promise.resolve([]), options.fetch(cursor)])).pipe(
            mergeMap(([beforeEvents, items]) => {
                const fresh = items.filter(item => !seen.has(options.itemId(item)));
                for (const item of fresh) {
                    seen.add(options.itemId(item));
                    cursor = options.advanceCursor(item);
                }

                const terminalIdx = options.isTerminal
                    ? fresh.findIndex(item => options.isTerminal!(item))
                    : -1;
                if (terminalIdx >= 0) {
                    // Stop the polling AFTER emitting up-to-and-including the
                    // terminal item plus the synthetic sentinel. Drops any
                    // items the runtime happened to emit AFTER the terminal
                    // event in the same tick — those would race with the
                    // close anyway and serve no purpose.
                    const terminalItem = fresh[terminalIdx];
                    const tail = options.toTerminalEvent?.(terminalItem);
                    const composed = Promise.all([
                        expandBatch(fresh.slice(0, terminalIdx + 1)),
                        options.afterTerminalEvents
                            ? options.afterTerminalEvents(terminalItem).catch(() => [] as MessageEvent[])
                            : Promise.resolve([] as MessageEvent[]),
                    ]).then(([upTo, extras]) => [
                        ...beforeEvents,
                        ...upTo,
                        ...extras,
                        ...(tail ? [tail] : []),
                    ]);
                    return from(composed).pipe(
                        mergeMap(events => from(events)),
                        finalize(() => terminate$.next()),
                    );
                }
                if (fresh.length === 0 && beforeEvents.length === 0) return of(options.toHeartbeat());
                return from(expandBatch(fresh).then(evts => [...beforeEvents, ...evts])).pipe(
                    mergeMap(events => from(events)),
                );
            }),
            catchError(error => of(options.toError(error))),
        );

    // 独立 keepalive 与 poll tick 并行 merge:即便某个 tick 在 beforeEvents+fetch 里阻塞、
    // concatMap 串行卡住,这条定时器仍按 KEEPALIVE_INTERVAL_MS 发心跳帧维持连接(复用
    // toHeartbeat,客户端无需识别新事件类型)。terminate$ 触发时随合并流一起停止。
    const keepalive$ = interval(KEEPALIVE_INTERVAL_MS).pipe(map(() => options.toHeartbeat()));
    // finalize 里 complete terminate$:流终止/退订时把 Subject 也 complete 掉(卫生,
    // 与同类内联 SSE 流一致;next 已触发 takeUntil 取消,complete 仅释放订阅者引用)。
    const ticker = merge(
        interval(options.pollIntervalMs).pipe(startWith(0), concatMap(tick)),
        keepalive$,
    ).pipe(
        takeUntil(terminate$),
        finalize(() => terminate$.complete()),
    );

    if (!options.accessCheck) return ticker;

    return defer(() => from(options.accessCheck!())).pipe(
        concatMap(() => ticker),
        catchError(error => of(options.toError(error))),
    );
}

export function clampPollIntervalMs(value: number | undefined, defaultMs: number): number {
    return Math.min(Math.max(value ?? defaultMs, 500), 10000);
}
