import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText } from "lucide-react";
import {
  CommandType,
  DocumentDataModel,
  type ICommandInfo,
  type IDocumentData,
  LogLevel,
  LocaleType,
  Univer,
  UniverInstanceType,
} from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";
import { UniverDocsCorePreset } from "@univerjs/preset-docs-core";
import docsZhCN from "@univerjs/preset-docs-core/locales/zh-CN";
import "@univerjs/preset-docs-core/lib/index.css";
import type { IDockviewPanelProps } from "@/desktop/components/dockview";
import { toast } from "sonner";
import { workspaceApi } from "@/lib/workspace-api";
import {
  FILE_EDITOR_SAVE_ALL_EVENT,
  type FileEditorSaveAllDetail,
} from "./events";
import {
  docxBytesToUniverDocumentSnapshot,
  getOfficeExtension,
  getOfficeFileName,
  univerDocumentSnapshotToDocxBytes,
} from "@a3s-lab/ooxml";
import { OfficePanelShell, type OfficePanelStatus } from "./office-panel-shell";

type SaveStatus = OfficePanelStatus;

interface UniverDocumentPanelParams {
  path: string;
  commandScope?: string;
  readOnly?: boolean;
  onDirtyChange?: (path: string, isDirty: boolean) => void;
  workbenchVariant?: "default" | "vscode";
}

interface UniverDocumentRuntime {
  univer: { dispose(): void };
  document: DocumentDataModel;
  commandDisposable?: { dispose(): void };
}

type DocsUniverAPI = ReturnType<typeof FUniver.newAPI> & {
  onCommandExecuted(listener: (command: ICommandInfo) => void): {
    dispose(): void;
  };
};

function createDocsUniver(container: HTMLElement) {
  const univer = new Univer({
    logLevel: LogLevel.WARN,
    locale: LocaleType.ZH_CN,
    locales: { [LocaleType.ZH_CN]: docsZhCN },
  });
  const docsPreset = UniverDocsCorePreset({
    container,
    header: false,
    toolbar: true,
    footer: {},
  });

  for (const entry of docsPreset.plugins) {
    const [PluginCtor, config] = Array.isArray(entry)
      ? entry
      : [entry, undefined];
    univer.registerPlugin(PluginCtor as never, config as never);
  }

  return {
    univer,
    univerAPI: FUniver.newAPI(univer) as DocsUniverAPI,
  };
}

async function bytesToDocumentSnapshot(
  path: string,
  data: Uint8Array
): Promise<IDocumentData> {
  const ext = getOfficeExtension(path);
  if (ext !== "docx") {
    throw new Error(
      "Univer 当前只直接接入 .docx 文档；旧版 .doc 需要后续接入 Office 二进制导入器。"
    );
  }

  return docxBytesToUniverDocumentSnapshot(data, { filename: path });
}

function isDocumentMutation(command: ICommandInfo, documentId: string) {
  const params = command.params as
    | { unitId?: string; documentId?: string }
    | undefined;
  if (params?.unitId !== documentId && params?.documentId !== documentId)
    return false;
  return (
    command.type === CommandType.MUTATION ||
    command.id.startsWith("doc.") ||
    command.id.startsWith("docs.")
  );
}

export function UniverDocumentPanel({
  params,
  api,
}: IDockviewPanelProps<UniverDocumentPanelParams>) {
  const path = params?.path ?? "";
  const fileName = useMemo(() => getOfficeFileName(path), [path]);
  const ext = useMemo(() => getOfficeExtension(path), [path]);
  const canSave = ext === "docx";
  const readOnly = params?.readOnly === true || !canSave;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<UniverDocumentRuntime | null>(null);
  const dirtyRef = useRef(false);
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const markDirty = useCallback(
    (nextDirty: boolean) => {
      if (!path) return;
      dirtyRef.current = nextDirty;
      setStatus(nextDirty ? "dirty" : "ready");
      const nextTitle =
        params?.workbenchVariant === "vscode" || !nextDirty
          ? fileName
          : `${fileName} *`;
      api.setTitle(nextTitle);
      api.updateParameters({
        ...(params ?? {}),
        ...api.getParameters(),
        isDirty: nextDirty,
      });
      params?.onDirtyChange?.(path, nextDirty);
    },
    [api, fileName, params, path]
  );

  const handleSave = useCallback(async () => {
    if (readOnly || !path || !runtimeRef.current) return;
    try {
      setStatus("saving");
      const snapshot = runtimeRef.current.document.getSnapshot();
      const bytes = await univerDocumentSnapshotToDocxBytes(snapshot);
      await workspaceApi.writeBinaryFile(path, Array.from(bytes));
      markDirty(false);
      toast.success("文档已保存");
    } catch (error) {
      setStatus("error");
      setError(error instanceof Error ? error.message : "文档保存失败");
    }
  }, [markDirty, path, readOnly, retryCount]);

  useEffect(() => {
    const container = containerRef.current;
    if (!path || !container) return;

    let disposed = false;

    const cleanupRuntime = () => {
      runtimeRef.current?.commandDisposable?.dispose();
      runtimeRef.current?.univer.dispose();
      runtimeRef.current = null;
      container.replaceChildren();
    };

    cleanupRuntime();
    setStatus("loading");
    setError(null);
    dirtyRef.current = false;

    workspaceApi
      .readBinaryFile(path)
      .then((data) => bytesToDocumentSnapshot(path, data))
      .then((snapshot) => {
        if (disposed) return;
        const { univer, univerAPI } = createDocsUniver(container);
        const document = univer.createUnit<IDocumentData, DocumentDataModel>(
          UniverInstanceType.UNIVER_DOC,
          snapshot
        );
        if (readOnly) {
          document.setDisabled(true);
        }
        const documentId = document.getUnitId();
        const commandDisposable = univerAPI.onCommandExecuted((command) => {
          if (
            !readOnly &&
            !dirtyRef.current &&
            isDocumentMutation(command, documentId)
          ) {
            markDirty(true);
          }
        });
        runtimeRef.current = { univer, document, commandDisposable };
        setStatus("ready");
      })
      .catch((error) => {
        if (disposed) return;
        setStatus("error");
        setError(error instanceof Error ? error.message : "文档加载失败");
      });

    return () => {
      disposed = true;
      cleanupRuntime();
    };
  }, [markDirty, path, readOnly]);

  useEffect(() => {
    const handleSaveAll = (event: Event) => {
      const scope = (event as CustomEvent<FileEditorSaveAllDetail>).detail
        ?.scope;
      if (scope && scope !== params?.commandScope) return;
      if (dirtyRef.current) {
        void handleSave();
      }
    };
    document.addEventListener(FILE_EDITOR_SAVE_ALL_EVENT, handleSaveAll);
    return () =>
      document.removeEventListener(FILE_EDITOR_SAVE_ALL_EVENT, handleSaveAll);
  }, [handleSave, params?.commandScope]);

  return (
    <OfficePanelShell
      fileName={fileName}
      label="文档编辑器"
      editorLabel="文档编辑区域"
      loadingLabel="正在加载文档"
      icon={FileText}
      iconClassName="text-[#2563eb]"
      status={status}
      readOnly={readOnly}
      isDirty={dirtyRef.current}
      error={error}
      onSave={handleSave}
      onRetry={() => {
        if (runtimeRef.current && dirtyRef.current) {
          void handleSave();
          return;
        }
        setRetryCount((value) => value + 1);
      }}
      retryLabel={
        runtimeRef.current && dirtyRef.current ? "重试保存" : "重新加载"
      }
    >
      <div ref={containerRef} className="h-full w-full" />
    </OfficePanelShell>
  );
}
