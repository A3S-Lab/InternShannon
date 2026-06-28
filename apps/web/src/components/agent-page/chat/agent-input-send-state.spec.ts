import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveAgentInputControlState,
  resolveAgentInputEditorLabel,
  resolveAgentInputFooterNotice,
  resolveAgentInputHistoryCancel,
  resolveAgentInputHistoryNavigation,
  resolveAgentInputHistoryPreviewEdit,
  resolveAgentInputHistoryShortcut,
  resolveAgentInputSendButtonAriaLabel,
  resolveAgentInputSendButtonTitle,
  resolveAgentInputStatusHint,
  shouldKeepDraftAfterSend,
  shouldKeepInterruptPending,
} from "./agent-input-send-state.ts";

test("keeps the draft only when send explicitly reports failure", () => {
  assert.equal(shouldKeepDraftAfterSend(false), true);
  assert.equal(shouldKeepDraftAfterSend(true), false);
  assert.equal(shouldKeepDraftAfterSend(undefined), false);
});

test("keeps interrupt pending unless delivery explicitly reports failure", () => {
  assert.equal(shouldKeepInterruptPending(false), false);
  assert.equal(shouldKeepInterruptPending(true), true);
  assert.equal(shouldKeepInterruptPending(undefined), true);
});

function controlState(input: Partial<Parameters<typeof resolveAgentInputControlState>[0]> = {}) {
  return resolveAgentInputControlState({
    connectionStatus: "connected",
    isRunning: false,
    isSubmitting: false,
    isEmpty: true,
    pendingFileCount: 0,
    hasPendingFileUploads: false,
    isUploadingWorkspaceFiles: false,
    disabled: false,
    disableWhisper: false,
    ...input,
  });
}

test("allows normal sends for text or ready attachments while idle", () => {
  assert.equal(controlState({ isEmpty: false }).sendDisabled, false);
  assert.equal(controlState({ pendingFileCount: 1 }).sendDisabled, false);
});

test("blocks sends while idle when attachments are still loading", () => {
  const state = controlState({
    isEmpty: false,
    pendingFileCount: 1,
    hasPendingFileUploads: true,
  });

  assert.equal(state.allFilesReady, false);
  assert.equal(state.sendDisabled, true);
});

test("keeps draft sends clickable while reconnecting to the websocket", () => {
  const connecting = controlState({
    connectionStatus: "connecting",
    isEmpty: false,
  });
  const disconnected = controlState({
    connectionStatus: "disconnected",
    isEmpty: false,
  });
  const unknown = controlState({
    connectionStatus: undefined,
    isEmpty: false,
  });

  assert.equal(connecting.connectionReady, false);
  assert.equal(connecting.inputDisabled, false);
  assert.equal(connecting.sendDisabled, false);
  assert.equal(connecting.uploadDisabled, true);
  assert.equal(disconnected.sendDisabled, false);
  assert.equal(disconnected.uploadDisabled, true);
  assert.equal(unknown.sendDisabled, false);
  assert.equal(unknown.uploadDisabled, true);
});

test("keeps empty disconnected inputs idle instead of offering a reconnect send", () => {
  const emptyDisconnected = controlState({
    connectionStatus: "disconnected",
    isEmpty: true,
  });

  assert.equal(emptyDisconnected.connectionReady, false);
  assert.equal(emptyDisconnected.sendDisabled, true);
  assert.equal(emptyDisconnected.inputDisabled, false);
});

test("keeps workspace uploads available only after the local service is connected", () => {
  const connected = controlState({ connectionStatus: "connected" });
  const connecting = controlState({ connectionStatus: "connecting" });
  const disconnected = controlState({ connectionStatus: "disconnected" });

  assert.equal(connected.uploadDisabled, false);
  assert.equal(connected.uploadBlockReason, null);
  assert.equal(connecting.uploadDisabled, true);
  assert.equal(connecting.uploadBlockReason, "connecting");
  assert.equal(disconnected.uploadDisabled, true);
  assert.equal(disconnected.uploadBlockReason, "connecting");
});

test("explains disabled and in-flight workspace upload states", () => {
  const disabled = controlState({ disabled: true });
  const uploading = controlState({ isUploadingWorkspaceFiles: true });

  assert.equal(disabled.uploadDisabled, true);
  assert.equal(disabled.uploadBlockReason, "disabled");
  assert.equal(uploading.uploadDisabled, true);
  assert.equal(uploading.uploadBlockReason, "uploading");
});

test("keeps whisper input usable while a task is running", () => {
  const state = controlState({
    isRunning: true,
    disabled: true,
    isEmpty: false,
  });

  assert.equal(state.effectiveWhisperMode, true);
  assert.equal(state.inputDisabled, false);
  assert.equal(state.sendDisabled, false);
});

test("disables running input when whisper is unavailable", () => {
  const state = controlState({
    isRunning: true,
    disabled: true,
    disableWhisper: true,
    isEmpty: false,
  });

  assert.equal(state.effectiveWhisperMode, false);
  assert.equal(state.inputDisabled, true);
  assert.equal(state.submitBlocked, true);
  assert.equal(state.sendDisabled, true);
});

test("requires text for running whisper sends", () => {
  assert.equal(controlState({ isRunning: true, disabled: true, pendingFileCount: 1 }).sendDisabled, true);
});

test("describes connection and whisper helper states", () => {
  assert.deepEqual(
    resolveAgentInputStatusHint({
      connectionStatus: "connecting",
      effectiveWhisperMode: false,
    }),
    {
      tone: "info",
      text: "正在连接本地服务 · 可继续编辑草稿",
    },
  );
  assert.deepEqual(
    resolveAgentInputStatusHint({
      connectionStatus: "disconnected",
      effectiveWhisperMode: true,
    }),
    {
      tone: "warning",
      text: "本地服务连接已断开 · 正在尝试恢复",
    },
  );
  assert.deepEqual(
    resolveAgentInputStatusHint({
      connectionStatus: "connected",
      effectiveWhisperMode: true,
    }),
    {
      tone: "whisper",
      text: "主任务运行中 · 当前输入会作为悄悄话发送",
    },
  );
  assert.equal(
    resolveAgentInputStatusHint({
      connectionStatus: "connected",
      effectiveWhisperMode: false,
    }),
    null,
  );
});

test("prioritizes interrupt delivery errors over transient status hints", () => {
  assert.deepEqual(
    resolveAgentInputFooterNotice({
      interruptError: " 中断请求未送达 ",
      statusHint: {
        tone: "warning",
        text: "本地服务连接已断开 · 正在尝试恢复",
      },
    }),
    {
      tone: "error",
      text: "中断请求未送达",
      dismissLabel: "关闭中断错误提示",
      dismissTarget: "interrupt",
    },
  );
});

test("prioritizes explicit input action errors with their own dismiss label", () => {
  assert.deepEqual(
    resolveAgentInputFooterNotice({
      actionError: {
        message: " 发送失败，草稿已保留 ",
        dismissLabel: "关闭发送错误提示",
      },
      interruptError: "中断请求未送达",
      statusHint: {
        tone: "warning",
        text: "本地服务连接已断开 · 正在尝试恢复",
      },
    }),
    {
      tone: "error",
      text: "发送失败，草稿已保留",
      dismissLabel: "关闭发送错误提示",
      dismissTarget: "action",
    },
  );
});

test("falls back to the connection status hint when no interrupt error is visible", () => {
  const statusHint = {
    tone: "info" as const,
    text: "正在连接本地服务 · 可继续编辑草稿",
  };

  assert.deepEqual(
    resolveAgentInputFooterNotice({
      interruptError: "  ",
      statusHint,
    }),
    statusHint,
  );
  assert.equal(
    resolveAgentInputFooterNotice({
      interruptError: null,
      statusHint: null,
    }),
    null,
  );
});

test("labels the chat editor by the available input affordances", () => {
  assert.equal(
    resolveAgentInputEditorLabel({
      effectiveWhisperMode: false,
      inputDisabled: false,
      disableSlash: false,
      disableMention: false,
    }),
    "输入消息，斜杠触发指令，@ 提及工作区文件",
  );
  assert.equal(
    resolveAgentInputEditorLabel({
      effectiveWhisperMode: false,
      inputDisabled: false,
      disableSlash: true,
      disableMention: true,
    }),
    "输入消息",
  );
});

test("labels whisper and disabled chat editor states", () => {
  assert.equal(
    resolveAgentInputEditorLabel({
      effectiveWhisperMode: true,
      inputDisabled: false,
      disableSlash: false,
      disableMention: false,
    }),
    "输入悄悄话，不中断主任务",
  );
  assert.equal(
    resolveAgentInputEditorLabel({
      effectiveWhisperMode: false,
      inputDisabled: true,
      disableSlash: false,
      disableMention: false,
    }),
    "消息输入框不可用",
  );
});

function sendButtonTitle(input: Partial<Parameters<typeof resolveAgentInputSendButtonTitle>[0]> = {}) {
  return resolveAgentInputSendButtonTitle({
    effectiveWhisperMode: false,
    isSubmitting: false,
    connectionReady: true,
    inputDisabled: false,
    isUploadingWorkspaceFiles: false,
    hasDraft: true,
    allFilesReady: true,
    ...input,
  });
}

function sendButtonAriaLabel(input: Partial<Parameters<typeof resolveAgentInputSendButtonAriaLabel>[0]> = {}) {
  return resolveAgentInputSendButtonAriaLabel({
    effectiveWhisperMode: false,
    isSubmitting: false,
    connectionReady: true,
    inputDisabled: false,
    isUploadingWorkspaceFiles: false,
    hasDraft: true,
    allFilesReady: true,
    sendDisabled: false,
    ...input,
  });
}

test("explains why the send button is unavailable", () => {
  assert.equal(sendButtonTitle({ isSubmitting: true }), "正在发送");
  assert.equal(sendButtonTitle({ isUploadingWorkspaceFiles: true }), "文件上传完成后可发送");
  assert.equal(sendButtonTitle({ inputDisabled: true }), "当前会话暂不可发送");
  assert.equal(sendButtonTitle({ allFilesReady: false }), "附件处理完成后可发送");
  assert.equal(sendButtonTitle({ hasDraft: false }), "输入消息后发送");
  assert.equal(sendButtonTitle({ connectionReady: false }), "重连并发送");
});

test("labels available send and whisper actions", () => {
  assert.equal(sendButtonTitle(), "发送");
  assert.equal(sendButtonTitle({ effectiveWhisperMode: true }), "发送悄悄话");
  assert.equal(sendButtonAriaLabel(), "发送消息");
  assert.equal(sendButtonAriaLabel({ effectiveWhisperMode: true }), "发送悄悄话");
  assert.equal(sendButtonAriaLabel({ connectionReady: false }), "重连并发送消息");
  assert.equal(sendButtonAriaLabel({ connectionReady: false, effectiveWhisperMode: true }), "重连并发送悄悄话");
});

test("uses the disabled reason as the send button accessible label", () => {
  assert.equal(sendButtonAriaLabel({ sendDisabled: true, hasDraft: false }), "输入消息后发送");
  assert.equal(sendButtonAriaLabel({ sendDisabled: true, allFilesReady: false }), "附件处理完成后可发送");
});

test("only claims input history shortcuts at editor text boundaries", () => {
  assert.equal(
    resolveAgentInputHistoryShortcut({
      key: "ArrowUp",
      isEditorFocused: true,
      isEmpty: false,
      selectionBoundary: { atStart: true, atEnd: false, hasSelection: false },
    }),
    "previous",
  );
  assert.equal(
    resolveAgentInputHistoryShortcut({
      key: "ArrowDown",
      isEditorFocused: true,
      isEmpty: false,
      selectionBoundary: { atStart: false, atEnd: true, hasSelection: false },
    }),
    "next",
  );
  assert.equal(
    resolveAgentInputHistoryShortcut({
      key: "ArrowUp",
      isEditorFocused: true,
      isEmpty: false,
      selectionBoundary: { atStart: false, atEnd: false, hasSelection: false },
    }),
    null,
  );
  assert.equal(
    resolveAgentInputHistoryShortcut({
      key: "ArrowDown",
      isEditorFocused: true,
      isEmpty: false,
      selectionBoundary: { atStart: false, atEnd: false, hasSelection: false },
    }),
    null,
  );
});

test("does not claim input history shortcuts during selection or modified navigation", () => {
  assert.equal(
    resolveAgentInputHistoryShortcut({
      key: "ArrowUp",
      isEditorFocused: true,
      isEmpty: false,
      selectionBoundary: { atStart: true, atEnd: false, hasSelection: true },
    }),
    null,
  );
  assert.equal(
    resolveAgentInputHistoryShortcut({
      key: "ArrowUp",
      isEditorFocused: true,
      isEmpty: false,
      selectionBoundary: { atStart: true, atEnd: false, hasSelection: false },
      shiftKey: true,
    }),
    null,
  );
  assert.equal(
    resolveAgentInputHistoryShortcut({
      key: "ArrowDown",
      isEditorFocused: false,
      isEmpty: true,
      selectionBoundary: { atStart: true, atEnd: true, hasSelection: false },
    }),
    null,
  );
  assert.equal(
    resolveAgentInputHistoryShortcut({
      key: "Enter",
      isEditorFocused: true,
      isEmpty: true,
      selectionBoundary: { atStart: true, atEnd: true, hasSelection: false },
    }),
    null,
  );
});

test("keeps empty-editor input history usable when selection details are unavailable", () => {
  assert.equal(
    resolveAgentInputHistoryShortcut({
      key: "ArrowUp",
      isEditorFocused: true,
      isEmpty: true,
      selectionBoundary: null,
    }),
    "previous",
  );
  assert.equal(
    resolveAgentInputHistoryShortcut({
      key: "ArrowDown",
      isEditorFocused: true,
      isEmpty: false,
      selectionBoundary: null,
    }),
    null,
  );
});

test("cancels input history preview with Escape and restores the unsent draft", () => {
  assert.deepEqual(
    resolveAgentInputHistoryCancel({
      key: "Escape",
      isEditorFocused: true,
      historyIndex: 0,
      currentText: "latest request",
      draftBeforeHistory: "unsent draft",
    }),
    {
      didCancel: true,
      historyIndex: -1,
      text: "unsent draft",
      draftBeforeHistory: "",
    },
  );
});

test("does not cancel input history preview outside plain focused Escape", () => {
  assert.deepEqual(
    resolveAgentInputHistoryCancel({
      key: "Escape",
      isEditorFocused: false,
      historyIndex: 0,
      currentText: "latest request",
      draftBeforeHistory: "unsent draft",
    }),
    {
      didCancel: false,
      historyIndex: 0,
      text: "latest request",
      draftBeforeHistory: "unsent draft",
    },
  );
  assert.deepEqual(
    resolveAgentInputHistoryCancel({
      key: "Escape",
      isEditorFocused: true,
      historyIndex: -1,
      currentText: "normal draft",
      draftBeforeHistory: "",
    }),
    {
      didCancel: false,
      historyIndex: -1,
      text: "normal draft",
      draftBeforeHistory: "",
    },
  );
  assert.deepEqual(
    resolveAgentInputHistoryCancel({
      key: "Escape",
      isEditorFocused: true,
      historyIndex: 0,
      currentText: "latest request",
      draftBeforeHistory: "unsent draft",
      metaKey: true,
    }),
    {
      didCancel: false,
      historyIndex: 0,
      text: "latest request",
      draftBeforeHistory: "unsent draft",
    },
  );
});

test("does not persist the unchanged input history preview as the current draft", () => {
  assert.deepEqual(
    resolveAgentInputHistoryPreviewEdit({
      historyIndex: 0,
      previewText: "latest request",
      nextText: "latest request",
      draftBeforeHistory: "unsent draft",
    }),
    {
      didExitPreview: false,
      shouldPersistDraft: false,
      historyIndex: 0,
      draftBeforeHistory: "unsent draft",
    },
  );
});

test("exits input history preview when the user edits a previewed entry", () => {
  assert.deepEqual(
    resolveAgentInputHistoryPreviewEdit({
      historyIndex: 1,
      previewText: "older request",
      nextText: "older request with edits",
      draftBeforeHistory: "unsent draft",
    }),
    {
      didExitPreview: true,
      shouldPersistDraft: true,
      historyIndex: -1,
      draftBeforeHistory: "",
    },
  );
});

test("keeps ordinary input edits draft-persistable outside input history preview", () => {
  assert.deepEqual(
    resolveAgentInputHistoryPreviewEdit({
      historyIndex: -1,
      previewText: null,
      nextText: "normal draft",
      draftBeforeHistory: "",
    }),
    {
      didExitPreview: false,
      shouldPersistDraft: true,
      historyIndex: -1,
      draftBeforeHistory: "",
    },
  );
});

test("navigates input history from newest to older entries", () => {
  const first = resolveAgentInputHistoryNavigation({
    history: ["oldest request", "latest request"],
    historyIndex: -1,
    currentText: "unsent draft",
    draftBeforeHistory: "",
    direction: "previous",
  });

  assert.deepEqual(first, {
    didNavigate: true,
    historyIndex: 0,
    text: "latest request",
    draftBeforeHistory: "unsent draft",
  });

  const second = resolveAgentInputHistoryNavigation({
    history: ["oldest request", "latest request"],
    historyIndex: first.historyIndex,
    currentText: first.text,
    draftBeforeHistory: first.draftBeforeHistory,
    direction: "previous",
  });

  assert.deepEqual(second, {
    didNavigate: true,
    historyIndex: 1,
    text: "oldest request",
    draftBeforeHistory: "unsent draft",
  });
});

test("restores the unsent draft after leaving input history", () => {
  const older = resolveAgentInputHistoryNavigation({
    history: ["oldest request", "latest request"],
    historyIndex: 1,
    currentText: "oldest request",
    draftBeforeHistory: "unsent draft",
    direction: "next",
  });

  assert.deepEqual(older, {
    didNavigate: true,
    historyIndex: 0,
    text: "latest request",
    draftBeforeHistory: "unsent draft",
  });

  const restored = resolveAgentInputHistoryNavigation({
    history: ["oldest request", "latest request"],
    historyIndex: older.historyIndex,
    currentText: older.text,
    draftBeforeHistory: older.draftBeforeHistory,
    direction: "next",
  });

  assert.deepEqual(restored, {
    didNavigate: true,
    historyIndex: -1,
    text: "unsent draft",
    draftBeforeHistory: "",
  });
});

test("does not navigate input history when no entry is available", () => {
  assert.deepEqual(
    resolveAgentInputHistoryNavigation({
      history: [],
      historyIndex: -1,
      currentText: "draft",
      draftBeforeHistory: "",
      direction: "previous",
    }),
    {
      didNavigate: false,
      historyIndex: -1,
      text: "draft",
      draftBeforeHistory: "",
    },
  );
});
