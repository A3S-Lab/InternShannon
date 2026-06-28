import { useReactive } from "ahooks";
import { FileText, Loader2, Send, Terminal, Upload, X } from "lucide-react";
import type React from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { toast } from "sonner";
import { useSnapshot } from "valtio";
import type { SuggestionItem } from "@/components/tiptap-editor/mention-list";
import TiptapEditor, { type TiptapEditorRef } from "@/components/tiptap-editor/TiptapEditor";
import { dispatchFileTreeEditorCommand } from "@/components/workspace/file-tree-editor/events";
import { sendToSession } from "@/hooks/use-agent-ws";
import { agentApi } from "@/lib/agent-api";
import { readUserStorage, removeUserStorage, writeUserStorage } from "@/lib/browser-storage";
import { cn } from "@/lib/utils";
import agentModel from "@/models/agent.model";
import agentRegistryModel from "@/models/agent-registry.model";
import { AgentAvatar } from "../agent-avatar";
import {
  type AgentInputDraftStorage,
  clearAgentInputDraft,
  createAgentInputPendingFilesFromPrefillImages,
  normalizeAgentInputDraftText,
  persistAgentInputDraft,
  readAgentInputDraft,
} from "./agent-input-draft-state";
import {
  type AgentInputFooterActionError,
  type AgentInputInterruptResult,
  type AgentInputSendResult,
  resolveAgentInputControlState,
  resolveAgentInputEditorLabel,
  resolveAgentInputFooterNotice,
  resolveAgentInputHistoryCancel,
  resolveAgentInputHistoryNavigation,
  resolveAgentInputHistoryPreviewEdit,
  resolveAgentInputHistoryShortcut,
  resolveAgentInputPlaceholder,
  resolveAgentInputSendButtonAriaLabel,
  resolveAgentInputSendButtonTitle,
  resolveAgentInputStatusHint,
  resolveEditorSelectionBoundary,
  shouldKeepDraftAfterSend,
  shouldKeepInterruptPending,
} from "./agent-input-send-state";
import {
  clampUploadPercent,
  createPendingFileId,
  createPendingFilesFromPastedImages,
  fileLabelFromPath,
  formatUploadSizeText,
  getDroppedFiles,
  type PendingFile,
  resolveUploadButtonTitle,
  sanitizeWorkspaceFileName,
  type UploadedWorkspaceFile,
} from "./agent-input-upload-state";
import { resolveAgentSlashCommandSuggestions } from "./agent-slash-command-state";
import { SessionStatusBar } from "./session-status-bar";

export interface AgentInputRef {
  appendText: (text: string) => void;
  setText: (text: string) => void;
  focus: () => void;
  focusSlashCommand: () => void;
}

const agentInputDraftStorage: AgentInputDraftStorage = {
  read: (key) => readUserStorage(key, null, "session"),
  write: (key, value) => writeUserStorage(key, value, "session"),
  remove: (key) => removeUserStorage(key, "session"),
};

export const AgentInput = forwardRef<
  AgentInputRef,
  {
    sessionId: string;
    apiUrl?: string;
    disabled: boolean;
    readonlyCwd?: boolean;
    showStatusBar?: boolean;
    statusBarOptions?: {
      showModelSwitcher?: boolean;
    };
    disableMention?: boolean;
    disableWhisper?: boolean;
    disableSlash?: boolean;
    variant?: "default";
    placeholder?: string;
    workspaceDir?: string;
    onSend?: (
      text: string,
      images?: { mediaType: string; data: string }[],
      options?: { mode?: "default" | "whisper" },
    ) => AgentInputSendResult | Promise<AgentInputSendResult>;
    onInterrupt?: () => AgentInputInterruptResult | Promise<AgentInputInterruptResult>;
    inputActionError?: AgentInputFooterActionError | null;
    onDismissInputActionError?: () => void;
    interruptError?: string | null;
    onDismissInterruptError?: () => void;
  }
>(
  (
    {
      sessionId,
      apiUrl,
      disabled,
      onSend,
      readonlyCwd,
      showStatusBar = true,
      statusBarOptions,
      disableMention,
      disableWhisper = false,
      disableSlash,
      variant = "default",
      placeholder,
      workspaceDir,
      onInterrupt,
      inputActionError,
      onDismissInputActionError,
      interruptError,
      onDismissInterruptError,
    },
    ref,
  ) => {
    const rootRef = useRef<HTMLElement>(null);
    const editorRef = useRef<TiptapEditorRef>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const lastPersistedDraftRef = useRef<{ sessionId: string; text: string | null }>({ sessionId: "", text: null });
    const restoredDraftSessionRef = useRef<string | null>(null);
    const historyPreviewTextRef = useRef<string | null>(null);
    const state = useReactive({
      isEmpty: true,
      pendingFiles: [] as PendingFile[],
      isDragging: false,
      isUploadingWorkspaceFiles: false,
      uploadingWorkspaceFileCount: 0,
      workspaceUploadCompletedCount: 0,
      workspaceUploadCurrentIndex: 0,
      workspaceUploadCurrentName: "",
      workspaceUploadCurrentLoaded: 0,
      workspaceUploadCurrentTotal: 0,
      workspaceUploadCurrentPercent: 0,
      workspaceUploadOverallPercent: 0,
      isInterrupting: false,
      isSubmitting: false,
      inputHistory: [] as string[],
      inputHistoryIndex: -1,
      inputHistoryDraft: "",
      slashItems: [] as SuggestionItem[],
    });
    const dragCounterRef = useRef(0);
    const { sessions, sessionStatus, connectionStatus } = useSnapshot(agentModel.state);
    const agentRegistrySnap = useSnapshot(agentRegistryModel.state);
    const isRunning = sessionStatus[sessionId] === "running";
    const sessionConnectionStatus = connectionStatus[sessionId];
    const sessionState = sessions[sessionId];
    void variant;

    // Clear interrupting state when generation stops
    useEffect(() => {
      if (!isRunning) {
        state.isInterrupting = false;
      }
    }, [isRunning, state]);

    // Keyboard shortcuts: Cmd+Enter to send, Up/Down for history
    const hasPendingFileUploads = state.pendingFiles.some((f) => f.progress !== undefined);
    const controlState = resolveAgentInputControlState({
      connectionStatus: sessionConnectionStatus,
      isRunning,
      isSubmitting: state.isSubmitting,
      isEmpty: state.isEmpty,
      pendingFileCount: state.pendingFiles.length,
      hasPendingFileUploads,
      isUploadingWorkspaceFiles: state.isUploadingWorkspaceFiles,
      disabled,
      disableWhisper,
    });
    const { effectiveWhisperMode, inputDisabled, sendDisabled, uploadDisabled, uploadBlockReason } = controlState;
    const statusHint = resolveAgentInputStatusHint({
      connectionStatus: sessionConnectionStatus,
      effectiveWhisperMode,
    });
    const footerNotice = resolveAgentInputFooterNotice({
      actionError: inputActionError,
      interruptError,
      statusHint,
    });
    const dismissFooterNotice =
      footerNotice?.dismissTarget === "action"
        ? onDismissInputActionError
        : footerNotice?.dismissTarget === "interrupt"
          ? onDismissInterruptError
          : undefined;

    const persistCurrentDraft = useCallback(
      (text: string) => {
        const draft = normalizeAgentInputDraftText(text);
        const lastPersisted = lastPersistedDraftRef.current;
        if (lastPersisted.sessionId === sessionId && lastPersisted.text === draft) return draft;

        const persisted = persistAgentInputDraft(agentInputDraftStorage, sessionId, text);
        lastPersistedDraftRef.current = { sessionId, text: persisted };
        return persisted;
      },
      [sessionId],
    );

    const clearCurrentDraft = useCallback(() => {
      clearAgentInputDraft(agentInputDraftStorage, sessionId);
      lastPersistedDraftRef.current = { sessionId, text: null };
    }, [sessionId]);

    const handleSubmit = useCallback(async (): Promise<boolean> => {
      if (sendDisabled) return false;
      const editor = editorRef.current;
      if (!editor) return false;
      const text = editor.getText().trim();
      if (!text && state.pendingFiles.length === 0) return false;
      const readyFiles = state.pendingFiles.filter((f) => f.progress === undefined);
      const draftFiles = [...readyFiles];
      const images = readyFiles.map((f) => ({
        mediaType: f.mediaType,
        data: f.data,
      }));
      state.isSubmitting = true;

      try {
        const result = await onSend?.(text, images.length > 0 ? images : undefined, {
          mode: effectiveWhisperMode ? "whisper" : "default",
        });
        // Add to input history only after the send path accepted the draft.
        if (text && !shouldKeepDraftAfterSend(result)) {
          if (state.inputHistory[state.inputHistory.length - 1] !== text) {
            state.inputHistory = [...state.inputHistory, text];
          }
        }

        if (shouldKeepDraftAfterSend(result)) {
          persistCurrentDraft(text);
          editor.setText(text);
          state.isEmpty = text.trim().length === 0 && draftFiles.length === 0;
          state.pendingFiles = draftFiles;
          state.inputHistoryIndex = -1;
          state.inputHistoryDraft = "";
          historyPreviewTextRef.current = null;
          setTimeout(() => editorRef.current?.focus(), 0);
          return false;
        }

        state.inputHistoryIndex = -1;
        state.inputHistoryDraft = "";
        historyPreviewTextRef.current = null;
        clearCurrentDraft();
        editor.clear();
        state.isEmpty = true;
        state.pendingFiles = [];
        setTimeout(() => editorRef.current?.focus(), 0);
        return true;
      } catch (error) {
        persistCurrentDraft(text);
        editor.setText(text);
        state.isEmpty = text.trim().length === 0 && draftFiles.length === 0;
        state.pendingFiles = draftFiles;
        state.inputHistoryIndex = -1;
        state.inputHistoryDraft = "";
        historyPreviewTextRef.current = null;
        toast.error(error instanceof Error ? error.message : "发送消息失败，已保留草稿");
        return false;
      } finally {
        state.isSubmitting = false;
      }
    }, [clearCurrentDraft, effectiveWhisperMode, onSend, persistCurrentDraft, sendDisabled, state]);

    // Consume any pending chat-input prefill (set e.g. by AssetProposalCard
    // "确认/修改/取消" buttons). When the per-session slot turns from null →
    // object, we push the text into the editor, optionally trigger send,
    // then clear the slot so it won't fire again on subsequent renders.
    const pendingPrefillSnap = useSnapshot(agentModel.state).pendingChatPrefill[sessionId];
    useEffect(() => {
      if (!pendingPrefillSnap) return;
      if (!editorRef.current) return;
      let cancelled = false;
      // 全新会话(如欢迎页示例提问一键开聊)创建后,Tiptap v3 的编辑视图要等 EditorContent 的
      // effect 把视图挂到 DOM 才可用;此时 setText/focus 会访问尚未挂载的 view.dom 而抛
      // 「editor view is not available」并把界面渲染打崩。改为:把整段「填充 + 自动发送」放进
      // try/catch,视图未就绪就用 rAF 退避重试,直到挂载完成才真正应用并消费 prefill(保持
      // setText 与 autoSend 同批,自动发送读到的是已填入的文本)。
      const apply = (attemptsLeft: number) => {
        if (cancelled) return;
        const editor = editorRef.current;
        if (!editor) return;
        try {
          editor.setText(pendingPrefillSnap.text);
        } catch {
          if (attemptsLeft > 0) {
            requestAnimationFrame(() => apply(attemptsLeft - 1));
          }
          return;
        }
        state.inputHistoryIndex = -1;
        state.inputHistoryDraft = "";
        historyPreviewTextRef.current = null;
        const prefilledFiles = createAgentInputPendingFilesFromPrefillImages(
          pendingPrefillSnap.images,
          createPendingFileId,
        );
        state.pendingFiles = prefilledFiles;
        state.isEmpty = pendingPrefillSnap.text.trim().length === 0 && prefilledFiles.length === 0;
        persistCurrentDraft(pendingPrefillSnap.text);
        const shouldAutoSend = pendingPrefillSnap.autoSend === true;
        // Clear the slot before auto-submitting, otherwise re-renders during
        // submit could re-trigger this effect.
        agentModel.consumeChatPrefill(sessionId);
        if (shouldAutoSend) {
          // Defer one tick so tiptap has settled the setText.
          setTimeout(() => void handleSubmit(), 0);
        } else {
          setTimeout(() => editorRef.current?.focus(), 0);
        }
      };
      apply(20);
      return () => {
        cancelled = true;
      };
    }, [pendingPrefillSnap, sessionId, handleSubmit, persistCurrentDraft, state]);

    useEffect(() => {
      if (pendingPrefillSnap) return;
      if (restoredDraftSessionRef.current === sessionId) return;
      const editor = editorRef.current;
      if (!editor) return;

      const draft = readAgentInputDraft(agentInputDraftStorage, sessionId);
      const normalizedDraft = normalizeAgentInputDraftText(draft);
      restoredDraftSessionRef.current = sessionId;
      lastPersistedDraftRef.current = { sessionId, text: normalizedDraft };
      if (draft) {
        editor.setText(draft);
      } else {
        editor.clear();
      }
      state.isEmpty = draft.trim().length === 0;
      state.pendingFiles = [];
      state.inputHistoryIndex = -1;
      state.inputHistoryDraft = "";
      historyPreviewTextRef.current = null;
    }, [pendingPrefillSnap, sessionId, state]);

    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        const editorEl = rootRef.current?.querySelector(".tiptap-content");
        const activeElement = document.activeElement;
        const isEditorFocused = Boolean(activeElement && editorEl?.contains(activeElement));

        // Cmd+Enter / Ctrl+Enter: Send message
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          if (isEditorFocused && !sendDisabled) {
            e.preventDefault();
            void handleSubmit();
          }
          return;
        }

        const currentText = editorRef.current?.getText() ?? "";
        const historyCancel = resolveAgentInputHistoryCancel({
          key: e.key,
          isEditorFocused,
          historyIndex: state.inputHistoryIndex,
          currentText,
          draftBeforeHistory: state.inputHistoryDraft,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
        });
        if (historyCancel.didCancel) {
          e.preventDefault();
          state.inputHistoryIndex = historyCancel.historyIndex;
          state.inputHistoryDraft = historyCancel.draftBeforeHistory;
          historyPreviewTextRef.current = null;
          editorRef.current?.setText(historyCancel.text);
          state.isEmpty = historyCancel.text.trim().length === 0;
          return;
        }

        const historyDirection = resolveAgentInputHistoryShortcut({
          key: e.key,
          isEditorFocused,
          isEmpty: state.isEmpty,
          selectionBoundary: resolveEditorSelectionBoundary(editorEl ?? null),
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
        });
        if (!historyDirection) return;

        e.preventDefault();

        const nextHistory = resolveAgentInputHistoryNavigation({
          history: state.inputHistory,
          historyIndex: state.inputHistoryIndex,
          currentText,
          draftBeforeHistory: state.inputHistoryDraft,
          direction: historyDirection,
        });
        if (!nextHistory.didNavigate) return;
        state.inputHistoryIndex = nextHistory.historyIndex;
        state.inputHistoryDraft = nextHistory.draftBeforeHistory;
        historyPreviewTextRef.current = nextHistory.historyIndex >= 0 ? nextHistory.text : null;
        editorRef.current?.setText(nextHistory.text);
        state.isEmpty = nextHistory.text.trim().length === 0;
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [state, sendDisabled, handleSubmit]);

    useEffect(() => {
      if (disableSlash || sessionConnectionStatus !== "connected") return;
      sendToSession(sessionId, { type: "session_status" });
    }, [disableSlash, sessionConnectionStatus, sessionId]);

    useEffect(() => {
      state.slashItems = resolveAgentSlashCommandSuggestions(sessionState?.slashCommands).map((command) => ({
        id: command.name,
        label: command.name,
        description: command.description,
        group: "命令",
        icon: <Terminal className="size-3 text-primary" />,
      }));
    }, [sessionState?.slashCommands, state]);

    const currentAgentId = agentRegistryModel.resolveSessionAgentId(sessionId);

    const mentionItems = useMemo(() => {
      // Read revision so the memo invalidates when the registry mutates.
      void agentRegistrySnap.revision;
      return agentRegistryModel
        .getAllAgents()
        .filter((p) => p.id !== "company-group" && p.id !== currentAgentId)
        .map((p) => ({
          id: p.id,
          label: p.name,
          description: p.description,
          group: "智能体",
          icon: <AgentAvatar agent={p} className="size-4 shrink-0" />,
        }));
    }, [agentRegistrySnap.revision, currentAgentId]);

    const uploadFilesToSessionWorkspace = useCallback(
      async (files: File[], skippedDirectories = 0) => {
        if (state.isUploadingWorkspaceFiles) {
          toast.info("文件正在上传中");
          return;
        }
        if (uploadBlockReason === "connecting") {
          toast.info("本地服务连接后才能上传文件");
          return;
        }
        if (uploadBlockReason === "disabled") return;
        if (files.length === 0) {
          if (skippedDirectories > 0) toast.info("已跳过文件夹，当前仅支持拖入文件");
          return;
        }

        if (!sessionId.trim()) {
          toast.error("未找到当前会话");
          return;
        }

        state.isUploadingWorkspaceFiles = true;
        state.uploadingWorkspaceFileCount = files.length;
        state.workspaceUploadCompletedCount = 0;
        state.workspaceUploadCurrentIndex = 0;
        state.workspaceUploadCurrentName = "";
        state.workspaceUploadCurrentLoaded = 0;
        state.workspaceUploadCurrentTotal = 0;
        state.workspaceUploadCurrentPercent = 0;
        state.workspaceUploadOverallPercent = 0;

        const uploaded: UploadedWorkspaceFile[] = [];
        const failed: string[] = [];
        try {
          for (const [index, file] of files.entries()) {
            try {
              state.workspaceUploadCurrentIndex = index + 1;
              state.workspaceUploadCurrentName = file.name;
              state.workspaceUploadCurrentLoaded = 0;
              state.workspaceUploadCurrentTotal = file.size;
              state.workspaceUploadCurrentPercent = 0;
              state.workspaceUploadOverallPercent = Math.round((index / files.length) * 100);
              const requestedPath = sanitizeWorkspaceFileName(file.name);
              const updateUploadProgress = (loaded: number, total: number) => {
                const safeTotal = Math.max(0, total || file.size);
                const safeLoaded = safeTotal > 0 ? Math.min(safeTotal, Math.max(0, loaded)) : 0;
                const fileFraction = safeTotal > 0 ? safeLoaded / safeTotal : 0;
                const percent = safeTotal > 0 ? clampUploadPercent(fileFraction * 100) : 0;

                state.workspaceUploadCurrentLoaded = safeLoaded;
                state.workspaceUploadCurrentTotal = safeTotal;
                state.workspaceUploadCurrentPercent = percent;
                state.workspaceUploadOverallPercent = clampUploadPercent(((index + fileFraction) / files.length) * 100);
              };

              const uploadedFile = await agentApi.uploadSessionWorkspaceFile(
                sessionId,
                requestedPath,
                file,
                {
                  conflictStrategy: "rename",
                  onProgress: updateUploadProgress,
                },
                apiUrl,
              );
              state.workspaceUploadCurrentLoaded = file.size;
              state.workspaceUploadCurrentTotal = file.size;
              state.workspaceUploadCurrentPercent = 100;
              state.workspaceUploadCompletedCount = index + 1;
              state.workspaceUploadOverallPercent = Math.round(((index + 1) / files.length) * 100);
              uploaded.push({
                path: uploadedFile.workspacePath || uploadedFile.path,
                label: fileLabelFromPath(uploadedFile.path, uploadedFile.fileName || requestedPath),
              });
            } catch (error) {
              console.error("[AgentInput] Failed to upload dropped file", {
                fileName: file.name,
                error,
              });
              failed.push(file.name);
            }
          }

          if (uploaded.length > 0) {
            editorRef.current?.appendFileMentions(uploaded);
            state.isEmpty = false;
            dispatchFileTreeEditorCommand("refresh");
            toast.success(
              uploaded.length === 1
                ? `已上传 ${uploaded[0].label} 到当前会话工作区`
                : `已上传 ${uploaded.length} 个文件到当前会话工作区`,
            );
          }
          if (failed.length > 0) {
            toast.error(failed.length === 1 ? `上传失败：${failed[0]}` : `${failed.length} 个文件上传失败`);
          }
          if (skippedDirectories > 0) {
            toast.info("已跳过文件夹，当前仅支持拖入文件");
          }
        } finally {
          state.isUploadingWorkspaceFiles = false;
          state.uploadingWorkspaceFileCount = 0;
          state.workspaceUploadCompletedCount = 0;
          state.workspaceUploadCurrentIndex = 0;
          state.workspaceUploadCurrentName = "";
          state.workspaceUploadCurrentLoaded = 0;
          state.workspaceUploadCurrentTotal = 0;
          state.workspaceUploadCurrentPercent = 0;
          state.workspaceUploadOverallPercent = 0;
        }
      },
      [apiUrl, sessionId, state, uploadBlockReason],
    );

    const removeFile = useCallback(
      (id: string) => {
        state.pendingFiles = state.pendingFiles.filter((f) => f.id !== id);
      },
      [state],
    );

    // ── Handlers ──

    const handleEditorChange = useCallback(
      (text: string) => {
        const trimmed = text.trim();
        const historyPreviewEdit = resolveAgentInputHistoryPreviewEdit({
          historyIndex: state.inputHistoryIndex,
          previewText: historyPreviewTextRef.current,
          nextText: text,
          draftBeforeHistory: state.inputHistoryDraft,
        });
        if (historyPreviewEdit.didExitPreview) {
          state.inputHistoryIndex = historyPreviewEdit.historyIndex;
          state.inputHistoryDraft = historyPreviewEdit.draftBeforeHistory;
          historyPreviewTextRef.current = null;
        }
        state.isEmpty = !trimmed;
        if (!historyPreviewEdit.shouldPersistDraft) return;
        persistCurrentDraft(text);
      },
      [persistCurrentDraft, state],
    );

    const handlePasteImages = useCallback(
      (images: { mediaType: string; data: string }[]) => {
        if (disabled) return;
        const newFiles = createPendingFilesFromPastedImages(images);
        state.pendingFiles = [...state.pendingFiles, ...newFiles];
      },
      [disabled, state],
    );

    const handleInterrupt = useCallback(async () => {
      if (state.isInterrupting) return;
      state.isInterrupting = true;
      try {
        const result = onInterrupt ? await onInterrupt() : sendToSession(sessionId, { type: "interrupt" });
        if (!shouldKeepInterruptPending(result)) {
          state.isInterrupting = false;
          if (!onInterrupt) {
            toast.error("中断请求未送达，请检查本地服务连接");
          }
        }
      } catch (error) {
        state.isInterrupting = false;
        toast.error(error instanceof Error ? error.message : "中断请求失败");
      }
    }, [onInterrupt, sessionId, state]);

    // ── Drag and drop ──

    const handleDragEnter = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current++;
        if (e.dataTransfer.types.includes("Files") && !uploadDisabled) {
          state.isDragging = true;
        }
      },
      [state, uploadDisabled],
    );

    const handleDragLeave = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current--;
        if (dragCounterRef.current === 0) {
          state.isDragging = false;
        }
      },
      [state],
    );

    const handleDragOver = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.types.includes("Files")) {
          e.dataTransfer.dropEffect = uploadDisabled ? "none" : "copy";
        }
      },
      [uploadDisabled],
    );

    const handleDrop = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current = 0;
        state.isDragging = false;
        const { files, skippedDirectories } = getDroppedFiles(e.dataTransfer);
        if (files.length > 0 || skippedDirectories > 0) void uploadFilesToSessionWorkspace(files, skippedDirectories);
      },
      [state, uploadFilesToSessionWorkspace],
    );

    const handleChooseFiles = useCallback(() => {
      if (uploadDisabled) return;
      fileInputRef.current?.click();
    }, [uploadDisabled]);

    const handleFileInputChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.currentTarget.files ?? []);
        e.currentTarget.value = "";
        if (files.length === 0) return;
        void uploadFilesToSessionWorkspace(files);
      },
      [uploadFilesToSessionWorkspace],
    );

    useImperativeHandle(
      ref,
      () => ({
        appendText: (text: string) => {
          if (!text) return;
          const editor = editorRef.current;
          editor?.appendText(text);
          persistCurrentDraft(editor?.getText() ?? text);
          state.isEmpty = false;
        },
        setText: (text: string) => {
          editorRef.current?.setText(text);
          persistCurrentDraft(text);
          state.isEmpty = !text;
        },
        focus: () => editorRef.current?.focus(),
        focusSlashCommand: () => {
          const editor = editorRef.current;
          if (!editor) return;
          const text = editor.getText();
          if (text.trim().length > 0) {
            editor.focus();
            return;
          }
          editor.setText("/");
          persistCurrentDraft("/");
          state.isEmpty = false;
        },
      }),
      [persistCurrentDraft, state],
    );

    const currentUploadPercent = clampUploadPercent(state.workspaceUploadCurrentPercent);
    const overallUploadPercent = clampUploadPercent(state.workspaceUploadOverallPercent);
    const currentUploadSizeText = formatUploadSizeText(
      state.workspaceUploadCurrentLoaded,
      state.workspaceUploadCurrentTotal,
    );
    const resolvedPlaceholder = resolveAgentInputPlaceholder({
      placeholder,
      effectiveWhisperMode,
      disableSlash: Boolean(disableSlash),
      disableMention: Boolean(disableMention),
    });
    const editorAriaLabel = resolveAgentInputEditorLabel({
      effectiveWhisperMode,
      inputDisabled,
      disableSlash: Boolean(disableSlash),
      disableMention: Boolean(disableMention),
    });
    const uploadButtonTitle = resolveUploadButtonTitle(uploadBlockReason);
    const sendButtonTitle = resolveAgentInputSendButtonTitle({
      effectiveWhisperMode,
      isSubmitting: state.isSubmitting,
      connectionReady: controlState.connectionReady,
      inputDisabled,
      isUploadingWorkspaceFiles: state.isUploadingWorkspaceFiles,
      hasDraft: controlState.hasDraft,
      allFilesReady: controlState.allFilesReady,
    });
    const sendButtonAriaLabel = resolveAgentInputSendButtonAriaLabel({
      effectiveWhisperMode,
      isSubmitting: state.isSubmitting,
      connectionReady: controlState.connectionReady,
      inputDisabled,
      isUploadingWorkspaceFiles: state.isUploadingWorkspaceFiles,
      hasDraft: controlState.hasDraft,
      allFilesReady: controlState.allFilesReady,
      sendDisabled,
    });

    return (
      <section
        ref={rootRef}
        className={cn(
          "relative flex h-full min-h-0 flex-col gap-1 overflow-hidden px-1.5 py-1 sm:px-2",
          "border-t border-border-light bg-white shadow-[rgba(36,36,36,0.05)_0px_-6px_12px_-12px]",
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        aria-label="智能体消息输入区"
      >
        {/* Drag overlay */}
        {state.isDragging && (
          <div className="pointer-events-none absolute inset-2.5 z-20 flex items-center justify-center rounded-[12px] border border-dashed border-primary/30 bg-primary/[0.04] backdrop-blur-sm">
            <div className="flex items-center gap-2 text-primary">
              <Upload className="size-5 opacity-70" />
              <span className="text-xs font-medium">松开上传到当前会话工作区</span>
            </div>
          </div>
        )}

        <div
          className={cn(
            "flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-[12px] border bg-white",
            "border-border-light shadow-[0_6px_14px_rgba(44,30,116,0.06)]",
            state.isDragging && "border-primary/40",
          )}
        >
          {/* File preview */}
          {state.pendingFiles.length > 0 ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-light bg-muted/20 px-3 py-2">
              {state.pendingFiles.map((file) => {
                const isImage = file.mediaType.startsWith("image/");
                const isLoading = file.progress !== undefined;
                return (
                  <div
                    key={file.id}
                    className="group relative flex max-w-[210px] items-center gap-2 rounded-[14px] border border-border-light bg-white py-1 pl-1.5 pr-2 shadow-[rgba(0,0,0,0.06)_0px_4px_6px]"
                  >
                    <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-muted">
                      {isLoading ? (
                        <Loader2 className="size-4 animate-spin text-primary" />
                      ) : isImage && file.data ? (
                        <img
                          src={`data:${file.mediaType};base64,${file.data}`}
                          alt={file.name}
                          className="size-8 object-cover"
                        />
                      ) : (
                        <FileText className="size-4 text-foreground/80" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-medium leading-tight text-foreground">{file.name}</p>
                      {isLoading ? (
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-[width] duration-300"
                            style={{ width: `${file.progress}%` }}
                          />
                        </div>
                      ) : (
                        <p className="text-[9px] leading-tight text-muted-foreground">{isImage ? "图片" : "文件"}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full border border-border bg-white text-foreground/80 opacity-0 shadow-[rgba(0,0,0,0.08)_0px_4px_6px] transition-colors group-hover:opacity-100 hover:border-red-200 dark:hover:border-red-800 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-500 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                      onClick={() => removeFile(file.id)}
                      aria-label="移除附件"
                    >
                      <X className="size-2.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 px-2 pt-1.5">
            <TiptapEditor
              ref={editorRef}
              className="h-full min-h-[32px] overflow-y-auto font-sans text-[13px] text-foreground [scrollbar-width:thin]"
              placeholder={resolvedPlaceholder}
              ariaLabel={editorAriaLabel}
              disabled={inputDisabled}
              disableSlash={disableSlash}
              allowEmptySubmit={state.pendingFiles.length > 0}
              slashItems={disableSlash ? [] : state.slashItems}
              mentionItems={disableMention ? [] : mentionItems}
              workspaceDir={workspaceDir}
              onSubmit={() => handleSubmit()}
              onChange={handleEditorChange}
              onPasteImages={handlePasteImages}
            />
          </div>

          {/* Bottom toolbar */}
          <div className="flex shrink-0 items-center justify-between gap-1.5 px-2 py-1">
            <div className="min-w-0 flex-1">
              {state.isUploadingWorkspaceFiles ? (
                <output
                  className="flex w-full max-w-[440px] flex-col gap-1 rounded-[8px] border border-primary/15 bg-primary/[0.04] px-2 py-1 text-[10px] leading-none"
                  aria-live="polite"
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Loader2 className="size-3 shrink-0 animate-spin text-primary" />
                    <span className="shrink-0 font-medium text-primary">上传到工作区</span>
                    <span className="shrink-0 tabular-nums text-primary/70">
                      {state.workspaceUploadCurrentIndex}/{state.uploadingWorkspaceFileCount}
                    </span>
                    <span className="min-w-0 truncate text-foreground/80">
                      {state.workspaceUploadCurrentName || "上传中"}
                    </span>
                    <span className="shrink-0 font-medium tabular-nums text-primary">{currentUploadPercent}%</span>
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="hidden shrink-0 tabular-nums text-muted-foreground sm:inline">
                      {currentUploadSizeText}
                    </span>
                    <span
                      className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-primary/15"
                      role="progressbar"
                      aria-label="工作区文件上传总进度"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={overallUploadPercent}
                    >
                      <span
                        className="block h-full rounded-full bg-primary transition-[width] duration-150"
                        style={{ width: `${overallUploadPercent}%` }}
                      />
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">整体 {overallUploadPercent}%</span>
                  </div>
                </output>
              ) : footerNotice ? (
                <div
                  className={cn(
                    "inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-0 text-[10px] font-medium leading-4",
                    footerNotice.tone === "whisper" &&
                      "border-amber-500/15 bg-amber-500/5 text-amber-700/85 dark:text-amber-300/85",
                    footerNotice.tone === "info" && "border-primary/15 bg-primary/[0.04] text-primary/85",
                    footerNotice.tone === "warning" &&
                      "border-red-500/15 bg-red-500/5 text-red-600/85 dark:text-red-300/85",
                    footerNotice.tone === "error" &&
                      "border-red-500/20 bg-red-500/[0.06] text-red-700 dark:text-red-300",
                  )}
                  role={footerNotice.tone === "error" ? "alert" : "status"}
                  aria-live="polite"
                >
                  <span
                    className={cn(
                      "size-1 shrink-0 rounded-full",
                      footerNotice.tone === "whisper" && "bg-amber-500/80",
                      footerNotice.tone === "info" && "bg-primary/80",
                      footerNotice.tone === "warning" && "bg-red-500/80",
                      footerNotice.tone === "error" && "bg-red-500",
                    )}
                  />
                  <span className="min-w-0 truncate">{footerNotice.text}</span>
                  {footerNotice.dismissLabel && dismissFooterNotice ? (
                    <button
                      type="button"
                      onClick={dismissFooterNotice}
                      className="-mr-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-red-600 transition-colors hover:bg-red-500/10"
                      title={footerNotice.dismissLabel}
                      aria-label={footerNotice.dismissLabel}
                    >
                      <X className="size-2.5" />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="inline-flex shrink-0 items-center gap-2">
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileInputChange} />
              {isRunning && (
                <button
                  type="button"
                  className={cn(
                    "inline-flex size-7 items-center justify-center rounded-full border text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40",
                    state.isInterrupting
                      ? "cursor-not-allowed border-red-100 bg-red-50 dark:bg-red-950/40 text-red-300"
                      : "border-red-100 bg-white text-red-500 hover:border-red-200 dark:hover:border-red-800 hover:bg-red-50 dark:hover:bg-red-950/40",
                  )}
                  disabled={state.isInterrupting}
                  onClick={() => void handleInterrupt()}
                  aria-label="中断"
                  title="中断任务"
                >
                  {state.isInterrupting ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                </button>
              )}
              <button
                type="button"
                className={cn(
                  "inline-flex size-7 items-center justify-center rounded-full border text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40",
                  uploadDisabled
                    ? "cursor-not-allowed border-border-light bg-[#f7f8fa] text-muted-foreground"
                    : "border-[#dbe4f0] bg-white text-foreground/80 hover:border-primary/25 hover:bg-primary/5 hover:text-primary",
                )}
                disabled={uploadDisabled}
                onClick={handleChooseFiles}
                aria-label="上传文件到工作区"
                title={uploadButtonTitle}
              >
                {state.isUploadingWorkspaceFiles ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Upload className="size-3.5" />
                )}
              </button>
              <button
                type="button"
                className={cn(
                  "inline-flex size-7 items-center justify-center rounded-full text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40",
                  sendDisabled
                    ? "cursor-not-allowed bg-muted text-muted-foreground"
                    : effectiveWhisperMode
                      ? "bg-amber-500 text-white shadow-[rgba(245,158,11,0.18)_0px_8px_18px_-8px] hover:bg-amber-600"
                      : "bg-primary text-white shadow-[rgba(44,30,116,0.16)_0px_0px_15px] hover:bg-[#2563eb]",
                )}
                disabled={sendDisabled}
                onClick={() => void handleSubmit()}
                aria-label={sendButtonAriaLabel}
                title={sendButtonTitle}
              >
                {state.isSubmitting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              </button>
            </div>
          </div>
        </div>

        {showStatusBar && (
          <SessionStatusBar
            apiUrl={apiUrl}
            sessionId={sessionId}
            readonlyCwd={readonlyCwd}
            showModelSwitcher={statusBarOptions?.showModelSwitcher}
          />
        )}
      </section>
    );
  },
);

AgentInput.displayName = "AgentInput";
