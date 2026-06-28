import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileSliders } from "lucide-react";
import {
  CommandType,
  type ICommandInfo,
  LogLevel,
  LocaleType,
  Univer,
  UniverInstanceType,
} from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";
import {
  UniverRenderEnginePlugin,
  UniverUIPlugin,
} from "@univerjs/preset-docs-core";
import docsZhCN from "@univerjs/preset-docs-core/locales/zh-CN";
import {
  SlideDataModel,
  UniverSlidesPlugin,
  type ISlideData,
} from "@univerjs/slides";
import { UniverSlidesUIPlugin } from "@univerjs/slides-ui";
import slidesZhCN from "@univerjs/slides-ui/locale/zh-CN";
import "@univerjs/preset-docs-core/lib/index.css";
import "@univerjs/slides-ui/lib/index.css";
import type { IDockviewPanelProps } from "@/desktop/components/dockview";
import { toast } from "sonner";
import { workspaceApi } from "@/lib/workspace-api";
import {
  FILE_EDITOR_SAVE_ALL_EVENT,
  type FileEditorSaveAllDetail,
} from "./events";
import {
  getOfficeExtension,
  getOfficeFileName,
  pptxBytesToUniverSlideSnapshot,
  univerSlideSnapshotToPptxBytes,
} from "@a3s-lab/ooxml";
import { OfficePanelShell, type OfficePanelStatus } from "./office-panel-shell";

type SaveStatus = OfficePanelStatus;

interface UniverPresentationPanelParams {
  path: string;
  commandScope?: string;
  readOnly?: boolean;
  onDirtyChange?: (path: string, isDirty: boolean) => void;
  workbenchVariant?: "default" | "vscode";
}

interface UniverPresentationRuntime {
  univer: { dispose(): void };
  slide: SlideDataModel;
  originalBytes: Uint8Array;
  commandDisposable?: { dispose(): void };
}

type SlidesUniverAPI = ReturnType<typeof FUniver.newAPI> & {
  onCommandExecuted(listener: (command: ICommandInfo) => void): {
    dispose(): void;
  };
};

function createSlidesUniver(container: HTMLElement) {
  const univer = new Univer({
    logLevel: LogLevel.WARN,
    locale: LocaleType.ZH_CN,
    locales: { [LocaleType.ZH_CN]: { ...docsZhCN, ...slidesZhCN } },
  });

  univer.registerPlugin(UniverRenderEnginePlugin);
  univer.registerPlugin(UniverUIPlugin, {
    container,
    header: false,
    toolbar: true,
    footer: {},
  } as never);
  univer.registerPlugin(UniverSlidesPlugin);
  univer.registerPlugin(UniverSlidesUIPlugin);

  return {
    univer,
    univerAPI: FUniver.newAPI(univer) as SlidesUniverAPI,
  };
}

async function bytesToSlideSnapshot(
  path: string,
  data: Uint8Array
): Promise<ISlideData> {
  const ext = getOfficeExtension(path);
  if (ext !== "pptx") {
    throw new Error(
      "Univer 当前只直接接入 .pptx 演示文稿；旧版 .ppt 需要后续接入 Office 二进制导入器。"
    );
  }

  return pptxBytesToUniverSlideSnapshot(data, { filename: path });
}

function isSlideMutation(command: ICommandInfo, slideId: string) {
  const params = command.params as { unitId?: string } | undefined;
  if (params?.unitId && params.unitId !== slideId) return false;
  return (
    command.type === CommandType.MUTATION || command.id.startsWith("slide.")
  );
}

export function UniverPresentationPanel({
  params,
  api,
}: IDockviewPanelProps<UniverPresentationPanelParams>) {
  const path = params?.path ?? "";
  const fileName = useMemo(() => getOfficeFileName(path), [path]);
  const ext = useMemo(() => getOfficeExtension(path), [path]);
  const readOnly = params?.readOnly === true || ext !== "pptx";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<UniverPresentationRuntime | null>(null);
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
      const bytes = await univerSlideSnapshotToPptxBytes(
        runtimeRef.current.slide.getSnapshot(),
        runtimeRef.current.originalBytes
      );
      await workspaceApi.writeBinaryFile(path, Array.from(bytes));
      markDirty(false);
      toast.success("演示文稿已保存");
    } catch (error) {
      setStatus("error");
      setError(error instanceof Error ? error.message : "演示文稿保存失败");
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
      .then(async (data) => ({
        data,
        snapshot: await bytesToSlideSnapshot(path, data),
      }))
      .then(({ data, snapshot }) => {
        if (disposed) return;
        const { univer, univerAPI } = createSlidesUniver(container);
        const slide = univer.createUnit<ISlideData, SlideDataModel>(
          UniverInstanceType.UNIVER_SLIDE,
          snapshot
        );
        const slideId = slide.getUnitId();
        const commandDisposable = univerAPI.onCommandExecuted((command) => {
          if (
            !readOnly &&
            !dirtyRef.current &&
            isSlideMutation(command, slideId)
          ) {
            markDirty(true);
          }
        });
        runtimeRef.current = {
          univer,
          slide,
          originalBytes: data,
          commandDisposable,
        };
        setStatus("ready");
      })
      .catch((error) => {
        if (disposed) return;
        setStatus("error");
        setError(error instanceof Error ? error.message : "演示文稿加载失败");
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
      label="演示文稿编辑器"
      editorLabel="演示文稿编辑区域"
      loadingLabel="正在加载演示文稿"
      icon={FileSliders}
      iconClassName="text-[#ea580c]"
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
