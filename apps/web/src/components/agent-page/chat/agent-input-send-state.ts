export type AgentInputSendResult = boolean | undefined;
export type AgentInputInterruptResult = boolean | undefined;
export type AgentInputConnectionStatus = "connecting" | "connected" | "disconnected";

export function shouldKeepDraftAfterSend(result: AgentInputSendResult): boolean {
  return result === false;
}

export function shouldKeepInterruptPending(result: AgentInputInterruptResult): boolean {
  return result !== false;
}

export interface AgentInputControlStateInput {
  connectionStatus?: AgentInputConnectionStatus;
  isRunning: boolean;
  isSubmitting: boolean;
  isEmpty: boolean;
  pendingFileCount: number;
  hasPendingFileUploads: boolean;
  isUploadingWorkspaceFiles: boolean;
  disabled: boolean;
  disableWhisper: boolean;
}

export interface AgentInputControlState {
  effectiveWhisperMode: boolean;
  hasDraft: boolean;
  allFilesReady: boolean;
  connectionReady: boolean;
  inputDisabled: boolean;
  submitBlocked: boolean;
  sendDisabled: boolean;
  uploadDisabled: boolean;
  uploadBlockReason: "disabled" | "connecting" | "uploading" | null;
}

export interface AgentInputStatusHintInput {
  connectionStatus?: AgentInputConnectionStatus;
  effectiveWhisperMode: boolean;
}

export interface AgentInputStatusHint {
  tone: "info" | "warning" | "whisper";
  text: string;
}

export type AgentInputFooterNoticeTone = AgentInputStatusHint["tone"] | "error";

export interface AgentInputFooterNotice {
  tone: AgentInputFooterNoticeTone;
  text: string;
  dismissLabel?: string;
  dismissTarget?: "action" | "interrupt";
}

export interface AgentInputFooterActionError {
  message?: string | null;
  dismissLabel: string;
}

export interface AgentInputFooterNoticeInput {
  actionError?: AgentInputFooterActionError | null;
  interruptError?: string | null;
  statusHint: AgentInputStatusHint | null;
}

export interface AgentInputEditorLabelInput {
  effectiveWhisperMode: boolean;
  inputDisabled: boolean;
  disableSlash: boolean;
  disableMention: boolean;
}

export interface AgentInputSendButtonTitleInput {
  effectiveWhisperMode: boolean;
  isSubmitting: boolean;
  connectionReady: boolean;
  inputDisabled: boolean;
  isUploadingWorkspaceFiles: boolean;
  hasDraft: boolean;
  allFilesReady: boolean;
}

export interface AgentInputSendButtonAriaLabelInput extends AgentInputSendButtonTitleInput {
  sendDisabled: boolean;
}

export type AgentInputHistoryDirection = "previous" | "next";

export interface AgentInputHistorySelectionBoundary {
  atStart: boolean;
  atEnd: boolean;
  hasSelection: boolean;
}

export interface AgentInputHistoryShortcutInput {
  key: string;
  isEditorFocused: boolean;
  isEmpty: boolean;
  selectionBoundary?: AgentInputHistorySelectionBoundary | null;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export interface AgentInputHistoryCancelInput {
  key: string;
  isEditorFocused: boolean;
  historyIndex: number;
  currentText: string;
  draftBeforeHistory: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export interface AgentInputHistoryPreviewEditInput {
  historyIndex: number;
  previewText?: string | null;
  nextText: string;
  draftBeforeHistory: string;
}

export interface AgentInputHistoryNavigationInput {
  history: readonly string[];
  historyIndex: number;
  currentText: string;
  draftBeforeHistory: string;
  direction: AgentInputHistoryDirection;
}

export interface AgentInputHistoryNavigationResult {
  didNavigate: boolean;
  historyIndex: number;
  text: string;
  draftBeforeHistory: string;
}

export interface AgentInputHistoryPreviewEditResult {
  didExitPreview: boolean;
  shouldPersistDraft: boolean;
  historyIndex: number;
  draftBeforeHistory: string;
}

export interface AgentInputHistoryCancelResult {
  didCancel: boolean;
  historyIndex: number;
  text: string;
  draftBeforeHistory: string;
}

export function resolveAgentInputControlState(input: AgentInputControlStateInput): AgentInputControlState {
  const effectiveWhisperMode = !input.disableWhisper && input.isRunning;
  const hasDraft = !input.isEmpty || input.pendingFileCount > 0;
  const allFilesReady = !input.hasPendingFileUploads;
  const connectionReady = input.connectionStatus === "connected";
  const inputDisabled = input.disabled && !effectiveWhisperMode;
  const submitBlocked = input.isSubmitting || inputDisabled;
  const runningSendBlocked = !effectiveWhisperMode || input.isEmpty;
  const idleSendBlocked = !hasDraft || !allFilesReady;
  const uploadBlockReason = input.disabled
    ? "disabled"
    : !connectionReady
      ? "connecting"
      : input.isUploadingWorkspaceFiles
        ? "uploading"
        : null;

  return {
    effectiveWhisperMode,
    hasDraft,
    allFilesReady,
    connectionReady,
    inputDisabled,
    submitBlocked,
    sendDisabled:
      submitBlocked || input.isUploadingWorkspaceFiles || (input.isRunning ? runningSendBlocked : idleSendBlocked),
    uploadDisabled: uploadBlockReason !== null,
    uploadBlockReason,
  };
}

export function resolveAgentInputStatusHint(input: AgentInputStatusHintInput): AgentInputStatusHint | null {
  if (input.connectionStatus !== "connected") {
    if (input.connectionStatus === "disconnected") {
      return {
        tone: "warning",
        text: "本地服务连接已断开 · 正在尝试恢复",
      };
    }
    return {
      tone: "info",
      text: "正在连接本地服务 · 可继续编辑草稿",
    };
  }
  if (input.effectiveWhisperMode) {
    return {
      tone: "whisper",
      text: "主任务运行中 · 当前输入会作为悄悄话发送",
    };
  }
  return null;
}

export function resolveAgentInputFooterNotice(input: AgentInputFooterNoticeInput): AgentInputFooterNotice | null {
  const actionError = input.actionError?.message?.trim();
  if (actionError) {
    return {
      tone: "error",
      text: actionError,
      dismissLabel: input.actionError?.dismissLabel,
      dismissTarget: "action",
    };
  }

  const interruptError = input.interruptError?.trim();
  if (interruptError) {
    return {
      tone: "error",
      text: interruptError,
      dismissLabel: "关闭中断错误提示",
      dismissTarget: "interrupt",
    };
  }

  return input.statusHint;
}

export function resolveAgentInputEditorLabel(input: AgentInputEditorLabelInput): string {
  if (input.inputDisabled) return "消息输入框不可用";
  if (input.effectiveWhisperMode) return "输入悄悄话，不中断主任务";

  const hints = [];
  if (!input.disableSlash) hints.push("斜杠触发指令");
  if (!input.disableMention) hints.push("@ 提及工作区文件");

  return hints.length > 0 ? `输入消息，${hints.join("，")}` : "输入消息";
}

export function resolveAgentInputSendButtonTitle(input: AgentInputSendButtonTitleInput): string {
  if (input.isSubmitting) return "正在发送";
  if (input.isUploadingWorkspaceFiles) return "文件上传完成后可发送";
  if (input.inputDisabled) return "当前会话暂不可发送";
  if (!input.allFilesReady) return "附件处理完成后可发送";
  if (!input.hasDraft) return "输入消息后发送";
  if (!input.connectionReady) return "重连并发送";
  return input.effectiveWhisperMode ? "发送悄悄话" : "发送";
}

export function resolveAgentInputSendButtonAriaLabel(input: AgentInputSendButtonAriaLabelInput): string {
  if (input.sendDisabled) return resolveAgentInputSendButtonTitle(input);
  if (!input.connectionReady) return input.effectiveWhisperMode ? "重连并发送悄悄话" : "重连并发送消息";
  return input.effectiveWhisperMode ? "发送悄悄话" : "发送消息";
}

export function resolveAgentInputHistoryShortcut(
  input: AgentInputHistoryShortcutInput,
): AgentInputHistoryDirection | null {
  if (!input.isEditorFocused) return null;
  if (input.metaKey || input.ctrlKey || input.altKey || input.shiftKey) return null;

  const direction = input.key === "ArrowUp" ? "previous" : input.key === "ArrowDown" ? "next" : null;
  if (!direction) return null;

  const boundary = input.selectionBoundary;
  if (!boundary) return input.isEmpty ? direction : null;
  if (boundary.hasSelection) return null;
  if (direction === "previous") return boundary.atStart ? direction : null;
  return boundary.atEnd ? direction : null;
}

export function resolveAgentInputHistoryCancel(input: AgentInputHistoryCancelInput): AgentInputHistoryCancelResult {
  if (
    !input.isEditorFocused ||
    input.key !== "Escape" ||
    input.historyIndex < 0 ||
    input.metaKey ||
    input.ctrlKey ||
    input.altKey ||
    input.shiftKey
  ) {
    return {
      didCancel: false,
      historyIndex: input.historyIndex,
      text: input.currentText,
      draftBeforeHistory: input.draftBeforeHistory,
    };
  }

  return {
    didCancel: true,
    historyIndex: -1,
    text: input.draftBeforeHistory,
    draftBeforeHistory: "",
  };
}

export function resolveAgentInputHistoryPreviewEdit(
  input: AgentInputHistoryPreviewEditInput,
): AgentInputHistoryPreviewEditResult {
  if (input.historyIndex < 0) {
    return {
      didExitPreview: false,
      shouldPersistDraft: true,
      historyIndex: input.historyIndex,
      draftBeforeHistory: input.draftBeforeHistory,
    };
  }

  if (input.previewText === input.nextText) {
    return {
      didExitPreview: false,
      shouldPersistDraft: false,
      historyIndex: input.historyIndex,
      draftBeforeHistory: input.draftBeforeHistory,
    };
  }

  return {
    didExitPreview: true,
    shouldPersistDraft: true,
    historyIndex: -1,
    draftBeforeHistory: "",
  };
}

export function resolveAgentInputHistoryNavigation(
  input: AgentInputHistoryNavigationInput,
): AgentInputHistoryNavigationResult {
  const history = input.history.filter((item) => item.trim().length > 0);
  if (history.length === 0) {
    return {
      didNavigate: false,
      historyIndex: input.historyIndex,
      text: input.currentText,
      draftBeforeHistory: input.draftBeforeHistory,
    };
  }

  if (input.direction === "previous") {
    const historyIndex = input.historyIndex < 0 ? 0 : Math.min(input.historyIndex + 1, history.length - 1);
    return {
      didNavigate: true,
      historyIndex,
      text: history[history.length - 1 - historyIndex] ?? "",
      draftBeforeHistory: input.historyIndex < 0 ? input.currentText : input.draftBeforeHistory,
    };
  }

  if (input.historyIndex < 0) {
    return {
      didNavigate: false,
      historyIndex: input.historyIndex,
      text: input.currentText,
      draftBeforeHistory: input.draftBeforeHistory,
    };
  }

  if (input.historyIndex === 0) {
    return {
      didNavigate: true,
      historyIndex: -1,
      text: input.draftBeforeHistory,
      draftBeforeHistory: "",
    };
  }

  const historyIndex = input.historyIndex - 1;
  return {
    didNavigate: true,
    historyIndex,
    text: history[history.length - 1 - historyIndex] ?? "",
    draftBeforeHistory: input.draftBeforeHistory,
  };
}

export function resolveEditorSelectionBoundary(editorEl: Element | null): AgentInputHistorySelectionBoundary | null {
  if (!editorEl) return null;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  if (!selection.anchorNode || !selection.focusNode) return null;
  if (!editorEl.contains(selection.anchorNode) || !editorEl.contains(selection.focusNode)) return null;

  const range = selection.getRangeAt(0);
  const before = range.cloneRange();
  before.selectNodeContents(editorEl);
  before.setEnd(range.startContainer, range.startOffset);

  const after = range.cloneRange();
  after.selectNodeContents(editorEl);
  after.setStart(range.endContainer, range.endOffset);

  return {
    atStart: before.toString().length === 0,
    atEnd: after.toString().length === 0,
    hasSelection: !selection.isCollapsed,
  };
}

export function resolveAgentInputPlaceholder(input: {
  placeholder?: string;
  effectiveWhisperMode: boolean;
  disableSlash: boolean;
  disableMention: boolean;
}): string {
  if (input.placeholder) return input.placeholder;
  if (input.effectiveWhisperMode) return "输入悄悄话…（不中断主任务）";
  if (input.disableSlash) {
    return input.disableMention ? "输入消息…" : "输入消息，@ 提及工作区文件…";
  }
  return input.disableMention ? "输入消息，/ 触发指令…" : "输入消息，/ 触发指令，@ 提及工作区文件…";
}
