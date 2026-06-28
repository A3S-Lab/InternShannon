import * as assert from "node:assert/strict";
import { test } from "node:test";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

test("keeps replayed InternShannon memory events idempotent in the local timeline", async () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  (globalThis as typeof globalThis & { window?: unknown }).window = {
    localStorage,
    sessionStorage,
    addEventListener() {},
  };

  const timeline = await import("./internShannon-memory-timeline.ts");

  timeline.recordInternShannonMemoryEvent({
    sessionId: "session-1",
    event: {
      type: "memory_stored",
      memoryId: "memory-1",
      memoryType: "profile",
      content: "用户偏好小步提交",
    },
    now: 1_000,
  });
  timeline.recordInternShannonMemoryEvent({
    sessionId: "session-1",
    event: {
      type: "memory_stored",
      memoryId: "memory-1",
      memoryType: "profile",
      content: "用户偏好小步提交",
    },
    now: 1_100,
  });

  const items = timeline.readInternShannonMemoryTimeline();

  assert.deepEqual(
    items.map((item) => item.memoryId),
    ["memory-1"],
  );
});

test("keeps edited no-id InternShannon memory events idempotent when the original event replays", async () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  (globalThis as typeof globalThis & { window?: unknown }).window = {
    localStorage,
    sessionStorage,
    addEventListener() {},
  };

  const timeline = await import("./internShannon-memory-timeline.ts");
  const first = timeline.recordInternShannonMemoryEvent({
    sessionId: "session-1",
    event: {
      type: "memory_stored",
      memoryType: "profile",
      content: "用户偏好小步提交",
    },
    now: 2_000,
  });

  assert.ok(first);
  timeline.updateInternShannonMemoryTimelineItem(first.id, { content: "用户偏好先写测试再小步提交" });
  timeline.recordInternShannonMemoryEvent({
    sessionId: "session-1",
    event: {
      type: "memory_stored",
      memoryType: "profile",
      content: "用户偏好小步提交",
    },
    now: 2_100,
  });

  const items = timeline.readInternShannonMemoryTimeline();

  assert.equal(items.length, 1);
  assert.equal(items[0]?.content, "用户偏好先写测试再小步提交");
  assert.equal(items[0]?.originalContent, "用户偏好小步提交");
});

test("keeps no-id InternShannon memory events idempotent after trimming local session ids", async () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  (globalThis as typeof globalThis & { window?: unknown }).window = {
    localStorage,
    sessionStorage,
    addEventListener() {},
  };

  const timeline = await import("./internShannon-memory-timeline.ts");

  timeline.recordInternShannonMemoryEvent({
    sessionId: " session-1 ",
    event: {
      type: "memory_stored",
      memoryType: "profile",
      content: "用户偏好小步提交",
    },
    now: 2_200,
  });
  timeline.recordInternShannonMemoryEvent({
    sessionId: "session-1",
    event: {
      type: "memory_stored",
      memoryType: "profile",
      content: "用户偏好小步提交",
    },
    now: 2_300,
  });

  const items = timeline.readInternShannonMemoryTimeline();

  assert.equal(items.length, 1);
  assert.equal(items[0]?.sessionId, "session-1");
  assert.equal(items[0]?.conversation.sessionId, "session-1");
});

test("keeps matching no-id InternShannon memory events from different sessions visible", async () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  (globalThis as typeof globalThis & { window?: unknown }).window = {
    localStorage,
    sessionStorage,
    addEventListener() {},
  };

  const timeline = await import("./internShannon-memory-timeline.ts");

  timeline.recordInternShannonMemoryEvent({
    sessionId: "session-1",
    event: {
      type: "memory_stored",
      memoryType: "profile",
      content: "用户偏好小步提交",
    },
    now: 3_000,
  });
  timeline.recordInternShannonMemoryEvent({
    sessionId: "session-2",
    event: {
      type: "memory_stored",
      memoryType: "profile",
      content: "用户偏好小步提交",
    },
    now: 3_100,
  });

  const items = timeline.readInternShannonMemoryTimeline();

  assert.deepEqual(
    items.map((item) => item.sessionId),
    ["session-2", "session-1"],
  );
});
