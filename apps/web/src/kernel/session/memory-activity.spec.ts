import * as assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeMemoryActivity } from "./memory-activity.ts";

test("normalizes legacy memory aliases before InternShannon renders recall summaries", () => {
  assert.deepEqual(
    normalizeMemoryActivity(
      {
        type: "memory_recalled",
        memory_type: "semantic",
        result_count: "3",
      },
      { timestamp: 7_000 },
    ),
    {
      id: "memory_recalled:7000",
      kind: "main_agent",
      status: "completed",
      phase: "memory_recalled",
      label: "记忆已召回（semantic）",
      detail: "结果数：3",
      source: "记忆系统",
      timestamp: 7_000,
    },
  );
});

test("ignores blank memory recall aliases before InternShannon renders recall summaries", () => {
  assert.deepEqual(
    normalizeMemoryActivity(
      {
        type: "memory_recalled",
        memoryType: "   ",
        memory_type: "semantic",
        resultCount: "   ",
        result_count: "4",
      },
      { timestamp: 7_100 },
    ),
    {
      id: "memory_recalled:7100",
      kind: "main_agent",
      status: "completed",
      phase: "memory_recalled",
      label: "记忆已召回（semantic）",
      detail: "结果数：4",
      source: "记忆系统",
      timestamp: 7_100,
    },
  );
});

test("keeps recalled memory content visible before InternShannon falls back to recall counts", () => {
  assert.deepEqual(
    normalizeMemoryActivity(
      {
        type: "memory_recalled",
        memoryType: "semantic",
        resultCount: 2,
        content: "用户偏好小步提交；用户希望提交信息包含中文总结",
      },
      { timestamp: 7_250 },
    ),
    {
      id: "memory_recalled:7250",
      kind: "main_agent",
      status: "completed",
      phase: "memory_recalled",
      label: "记忆已召回（semantic）",
      detail: "用户偏好小步提交；用户希望提交信息包含中文总结",
      source: "记忆系统",
      timestamp: 7_250,
    },
  );
});

test("keeps memory content visible before InternShannon renders write summaries", () => {
  assert.deepEqual(
    normalizeMemoryActivity(
      {
        type: "memory_stored",
        memoryType: "profile",
        content: "用户偏好先看测试结果再看实现说明",
      },
      { timestamp: 7_500 },
    ),
    {
      id: "memory_stored:7500",
      kind: "main_agent",
      status: "completed",
      phase: "memory_stored",
      label: "记忆已写入（profile）",
      detail: "用户偏好先看测试结果再看实现说明",
      source: "记忆系统",
      timestamp: 7_500,
    },
  );
});

test("keeps direct memory string content visible before InternShannon renders write activity", () => {
  assert.deepEqual(
    normalizeMemoryActivity(
      {
        type: "memory_stored",
        memoryType: "profile",
        memory: "用户希望InternShannon保留直接 memory 字符串内容",
      },
      { timestamp: 7_600 },
    ),
    {
      id: "memory_stored:7600",
      kind: "main_agent",
      status: "completed",
      phase: "memory_stored",
      label: "记忆已写入（profile）",
      detail: "用户希望InternShannon保留直接 memory 字符串内容",
      source: "记忆系统",
      timestamp: 7_600,
    },
  );
});

test("keeps memory message aliases visible before InternShannon renders write activity", () => {
  assert.deepEqual(
    normalizeMemoryActivity(
      {
        type: "memory_stored",
        memoryType: "profile",
        message: "用户希望InternShannon显示 message 别名里的记忆内容",
      },
      { timestamp: 7_650 },
    ),
    {
      id: "memory_stored:7650",
      kind: "main_agent",
      status: "completed",
      phase: "memory_stored",
      label: "记忆已写入（profile）",
      detail: "用户希望InternShannon显示 message 别名里的记忆内容",
      source: "记忆系统",
      timestamp: 7_650,
    },
  );
});

test("preserves legacy memory keys before InternShannon renders write activity", () => {
  assert.deepEqual(
    normalizeMemoryActivity(
      {
        type: "memory_stored",
        layer: "insight",
        memory_key: "internShannon.preference.commit-style",
      },
      { timestamp: 7_675 },
    ),
    {
      id: "memory_stored:7675",
      kind: "main_agent",
      status: "completed",
      phase: "memory_stored",
      label: "记忆已写入（insight）",
      detail: "internShannon.preference.commit-style",
      source: "记忆系统",
      timestamp: 7_675,
    },
  );
});

test("preserves nested memory detail before InternShannon renders write activity", () => {
  assert.deepEqual(
    normalizeMemoryActivity(
      {
        type: "memory_stored",
        memory: {
          typeLabel: "洞察层",
          detail: "用户偏好先看测试结果再看实现说明",
        },
      },
      { timestamp: 7_700 },
    ),
    {
      id: "memory_stored:7700",
      kind: "main_agent",
      status: "completed",
      phase: "memory_stored",
      label: "记忆已写入（洞察层）",
      detail: "用户偏好先看测试结果再看实现说明",
      source: "记忆系统",
      timestamp: 7_700,
    },
  );
});

test("preserves nested memory message aliases before InternShannon renders write activity", () => {
  assert.deepEqual(
    normalizeMemoryActivity(
      {
        type: "memory_stored",
        memory: {
          typeLabel: "洞察层",
          message: "用户希望InternShannon显示嵌套 message 里的记忆内容",
        },
      },
      { timestamp: 7_800 },
    ),
    {
      id: "memory_stored:7800",
      kind: "main_agent",
      status: "completed",
      phase: "memory_stored",
      label: "记忆已写入（洞察层）",
      detail: "用户希望InternShannon显示嵌套 message 里的记忆内容",
      source: "记忆系统",
      timestamp: 7_800,
    },
  );
});

test("preserves nested memory label aliases before InternShannon renders write activity", () => {
  assert.deepEqual(
    normalizeMemoryActivity(
      {
        type: "memory_stored",
        memory: {
          typeLabel: "洞察层",
          label: "用户希望InternShannon显示嵌套 label 里的记忆标题",
        },
      },
      { timestamp: 7_900 },
    ),
    {
      id: "memory_stored:7900",
      kind: "main_agent",
      status: "completed",
      phase: "memory_stored",
      label: "记忆已写入（洞察层）",
      detail: "用户希望InternShannon显示嵌套 label 里的记忆标题",
      source: "记忆系统",
      timestamp: 7_900,
    },
  );
});

test("preserves nested memory title aliases before InternShannon renders write activity", () => {
  assert.deepEqual(
    normalizeMemoryActivity(
      {
        type: "memory_stored",
        memory: {
          typeLabel: "洞察层",
          title: "用户希望InternShannon显示嵌套 title 里的记忆标题",
        },
      },
      { timestamp: 7_950 },
    ),
    {
      id: "memory_stored:7950",
      kind: "main_agent",
      status: "completed",
      phase: "memory_stored",
      label: "记忆已写入（洞察层）",
      detail: "用户希望InternShannon显示嵌套 title 里的记忆标题",
      source: "记忆系统",
      timestamp: 7_950,
    },
  );
});

test("preserves nested memory name aliases before InternShannon renders write activity", () => {
  assert.deepEqual(
    normalizeMemoryActivity(
      {
        type: "memory_stored",
        memory: {
          typeLabel: "洞察层",
          name: "用户希望InternShannon显示嵌套 name 里的记忆名称",
        },
      },
      { timestamp: 7_980 },
    ),
    {
      id: "memory_stored:7980",
      kind: "main_agent",
      status: "completed",
      phase: "memory_stored",
      label: "记忆已写入（洞察层）",
      detail: "用户希望InternShannon显示嵌套 name 里的记忆名称",
      source: "记忆系统",
      timestamp: 7_980,
    },
  );
});

test("preserves snake_case memory type labels before InternShannon renders activity", () => {
  assert.deepEqual(
    normalizeMemoryActivity(
      {
        type: "memory_stored",
        memory: {
          type_label: "洞察层",
          detail: "用户长期偏好先拆小步再提交",
        },
      },
      { timestamp: 7_900 },
    ),
    {
      id: "memory_stored:7900",
      kind: "main_agent",
      status: "completed",
      phase: "memory_stored",
      label: "记忆已写入（洞察层）",
      detail: "用户长期偏好先拆小步再提交",
      source: "记忆系统",
      timestamp: 7_900,
    },
  );
});
