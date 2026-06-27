/**
 * Minimal Server-Sent Events frame parser.
 *
 * 用于消费 a3s-code agentic 容器、tool agent 的 SSE 流。spec 子集：
 *   - `event: <type>`  — 事件名（缺省 `message`）
 *   - `data: <body>`   — 多行 data 拼成单条载荷（按 spec 用 `\n` 连）
 *   - 以 `:` 开头的行视为注释 / heartbeat，丢弃
 *   - 空行分隔帧（参见 `splitSseFrames`）
 *
 * 不支持 `id:` / `retry:` 字段（agentic 调试不需要重连定位）。
 */

export interface ParsedSseFrame {
    type: string;
    data: unknown;
}

export function parseSseFrame(frame: string): ParsedSseFrame | null {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of frame.split('\n')) {
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
    }
    if (dataLines.length === 0) return null;
    const raw = dataLines.join('\n');
    try {
        return { type: event, data: JSON.parse(raw) };
    } catch {
        return { type: event, data: raw };
    }
}

/**
 * 给定累积的 SSE 缓冲，切出所有完整帧 + 剩下的不完整尾巴。调用方持续调用
 * 这个函数，每次把上一次的 `remainder` 拼上新增片段再传进来。
 */
export function splitSseFrames(buffer: string): { frames: string[]; remainder: string } {
    const frames: string[] = [];
    let remainder = buffer;
    while (true) {
        const idx = remainder.indexOf('\n\n');
        if (idx === -1) break;
        frames.push(remainder.slice(0, idx));
        remainder = remainder.slice(idx + 2);
    }
    return { frames, remainder };
}
