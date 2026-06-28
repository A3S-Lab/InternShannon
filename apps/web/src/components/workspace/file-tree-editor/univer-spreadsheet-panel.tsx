import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Table2 } from "lucide-react";
import {
  CommandType,
  type ICommandInfo,
  LogLevel,
  LocaleType,
  Univer,
  type IWorkbookData,
} from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";
import {
  COMMAND_LISTENER_SKELETON_CHANGE,
  COMMAND_LISTENER_VALUE_CHANGE,
  UniverSheetsCorePreset,
} from "@univerjs/preset-sheets-core";
import sheetsZhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import "@univerjs/preset-sheets-core/lib/index.css";
import type { IDockviewPanelProps } from "@/desktop/components/dockview";
import { toast } from "sonner";
import {
  FILE_EDITOR_SAVE_ALL_EVENT,
  type FileEditorSaveAllDetail,
} from "./events";
import { workspaceApi } from "@/lib/workspace-api";
import {
  getOfficeExtension,
  getOfficeFileName,
  univerWorkbookSnapshotToBytes,
  workbookBytesToUniverSnapshot,
} from "@a3s-lab/ooxml";
import { OfficePanelShell, type OfficePanelStatus } from "./office-panel-shell";

type SaveStatus = OfficePanelStatus;

interface UniverSpreadsheetPanelParams {
  path: string;
  commandScope?: string;
  readOnly?: boolean;
  onDirtyChange?: (path: string, isDirty: boolean) => void;
  workbenchVariant?: "default" | "vscode";
}

interface UniverRuntime {
  univer: { dispose(): void };
  workbook: {
    getId(): string;
    save(): IWorkbookData;
    setEditable(value: boolean): unknown;
  };
  commandDisposable?: { dispose(): void };
}

type SheetsUniverAPI = ReturnType<typeof FUniver.newAPI> & {
  createWorkbook(data: Partial<IWorkbookData>): UniverRuntime["workbook"];
  onCommandExecuted(listener: (command: ICommandInfo) => void): {
    dispose(): void;
  };
};

const PERSISTENT_SHEET_COMMAND_IDS = new Set([
  ...COMMAND_LISTENER_VALUE_CHANGE,
  ...COMMAND_LISTENER_SKELETON_CHANGE,
]);

function createSheetsUniver(container: HTMLElement): {
  univer: Univer;
  univerAPI: SheetsUniverAPI;
} {
  const univer = new Univer({
    logLevel: LogLevel.WARN,
    locale: LocaleType.ZH_CN,
    locales: { [LocaleType.ZH_CN]: sheetsZhCN },
  });
  const sheetsPreset = UniverSheetsCorePreset({
    container,
    header: false,
    toolbar: true,
    footer: {},
    formulaBar: true,
  });

  for (const entry of sheetsPreset.plugins) {
    const [PluginCtor, config] = Array.isArray(entry)
      ? entry
      : [entry, undefined];
    univer.registerPlugin(PluginCtor as never, config as never);
  }

  return {
    univer,
    univerAPI: FUniver.newAPI(univer) as SheetsUniverAPI,
  };
}

function bytesToWorkbookSnapshot(
  path: string,
  data: Uint8Array
): IWorkbookData {
  return workbookBytesToUniverSnapshot(data, { filename: path });
}

function isPersistentSheetMutation(command: ICommandInfo, workbookId: string) {
  const params = command.params as { unitId?: string } | undefined;
  if (params?.unitId !== workbookId) return false;
  return (
    command.type === CommandType.MUTATION ||
    PERSISTENT_SHEET_COMMAND_IDS.has(command.id)
  );
}

export function UniverSpreadsheetPanel({
  params,
  api,
}: IDockviewPanelProps<UniverSpreadsheetPanelParams>) {
  const path = params?.path ?? "";
  const fileName = useMemo(() => getOfficeFileName(path), [path]);
  const ext = useMemo(() => getOfficeExtension(path), [path]);
  const readOnly = params?.readOnly === true;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<UniverRuntime | null>(null);
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
      const snapshot = runtimeRef.current.workbook.save();
      const bytes = univerWorkbookSnapshotToBytes(snapshot, ext);
      await workspaceApi.writeBinaryFile(path, Array.from(bytes));
      markDirty(false);
      toast.success("表格已保存");
    } catch (error) {
      setStatus("error");
      setError(error instanceof Error ? error.message : "表格保存失败");
    }
  }, [ext, markDirty, path, readOnly]);

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
      .then((data) => {
        if (disposed) return;
        const snapshot = bytesToWorkbookSnapshot(path, data);
        const { univer, univerAPI } = createSheetsUniver(container);
        const workbook = univerAPI.createWorkbook(snapshot);
        if (readOnly) {
          workbook.setEditable(false);
        }
        const workbookId = workbook.getId();
        const commandDisposable = univerAPI.onCommandExecuted((command) => {
          if (
            !readOnly &&
            !dirtyRef.current &&
            isPersistentSheetMutation(command, workbookId)
          ) {
            markDirty(true);
          }
        });
        runtimeRef.current = { univer, workbook, commandDisposable };
        setStatus("ready");
      })
      .catch((error) => {
        if (disposed) return;
        setStatus("error");
        setError(error instanceof Error ? error.message : "表格加载失败");
      });

    return () => {
      disposed = true;
      cleanupRuntime();
    };
  }, [markDirty, path, readOnly, retryCount]);

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
      label="表格编辑器"
      editorLabel="表格编辑区域"
      loadingLabel="正在加载表格"
      icon={Table2}
      iconClassName="text-[#16a34a]"
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
