type TextStreamSource = "direct" | "content_block";

interface RecentTextStreamDelta {
  source: TextStreamSource;
  text: string;
  index: number;
}

const MAX_RECENT_TEXT_DELTAS = 24;
const DUPLICATE_LOOKBACK = 8;

export class KernelStreamTextDedupe {
  private readonly recent: RecentTextStreamDelta[] = [];
  private index = 0;

  shouldDrop(message: Record<string, unknown> | null): boolean {
    const delta = textDeltaFromStreamMessage(message);
    if (!delta) return false;

    this.index += 1;
    const duplicate = this.recent.some(
      item =>
        item.source !== delta.source &&
        item.text === delta.text &&
        this.index - item.index <= DUPLICATE_LOOKBACK,
    );

    this.recent.push({ ...delta, index: this.index });
    if (this.recent.length > MAX_RECENT_TEXT_DELTAS) {
      this.recent.splice(0, this.recent.length - MAX_RECENT_TEXT_DELTAS);
    }

    return duplicate;
  }
}

function textDeltaFromStreamMessage(
  message: Record<string, unknown> | null,
): { source: TextStreamSource; text: string } | null {
  if (!message || message.type !== "stream_event") return null;
  const event = message.event;
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  return textDeltaFromEvent(event as Record<string, unknown>);
}

function textDeltaFromEvent(event: Record<string, unknown>): { source: TextStreamSource; text: string } | null {
  const eventType = typeof event.type === "string" ? event.type : "";
  if (eventType === "text_delta" || eventType === "text" || eventType === "output_text_delta") {
    const text = stringValue(event.text) ?? stringValue(event.content) ?? stringValue(event.delta);
    return text ? { source: "direct", text } : null;
  }
  if (eventType !== "content_block_delta") return null;

  const delta = event.delta;
  if (!delta || typeof delta !== "object" || Array.isArray(delta)) return null;
  const record = delta as Record<string, unknown>;
  const deltaType = typeof record.type === "string" ? record.type : "";
  if (deltaType !== "text_delta" && deltaType !== "output_text_delta") return null;
  const text = stringValue(record.text) ?? stringValue(record.content);
  return text ? { source: "content_block", text } : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
