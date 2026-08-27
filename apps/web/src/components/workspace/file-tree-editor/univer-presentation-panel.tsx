import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, FileSliders, Minus, Plus } from "lucide-react";
import {
  CommandType,
  ICommandService,
  type ICommandInfo,
  LogLevel,
  LocaleType,
  Univer,
  UniverInstanceType,
} from "@univerjs/core";
import {
  IRenderManagerService,
  UniverDocsCorePreset,
} from "@univerjs/preset-docs-core";
import docsZhCN from "@univerjs/preset-docs-core/locales/zh-CN";
import {
  PageElementType,
  SlideDataModel,
  UniverSlidesPlugin,
  type ISlideData,
} from "@univerjs/slides";
import { CanvasView, UniverSlidesUIPlugin } from "@univerjs/slides-ui";
import slidesZhCN from "@univerjs/slides-ui/locale/zh-CN";
import "@univerjs/preset-docs-core/lib/index.css";
import "@univerjs/slides-ui/lib/index.css";
import type { IDockviewPanelProps } from "@/desktop/components/dockview";
import { toast } from "@/components/ui/sonner";
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
import { disposeUniverAfterReactCommit } from "./univer-runtime-lifecycle";
import { installSlidesRenderViewportFallback, setSlidesRenderZoom, type SlidesRenderManager } from "./univer-slides-runtime";

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
  canvasView: CanvasView;
  renderManager: SlidesRenderManager;
  slideId: string;
  originalBytes: Uint8Array;
  commandDisposable?: { dispose(): void };
  wheelViewportDisposable?: { dispose(): void };
}

interface SlideTextEntry {
  key: string;
  pageId: string;
  elementId: string;
  text: string;
}

function createSlidesUniver(container: HTMLElement) {
  const univer = new Univer({
    logLevel: LogLevel.WARN,
    locale: LocaleType.ZH_CN,
    locales: { [LocaleType.ZH_CN]: { ...docsZhCN, ...slidesZhCN } },
  });

  const docsPreset = UniverDocsCorePreset({
    container,
    header: false,
    toolbar: true,
    footer: false,
  });
  for (const entry of docsPreset.plugins) {
    const [PluginCtor, config] = Array.isArray(entry)
      ? entry
      : [entry, undefined];
    univer.registerPlugin(PluginCtor as never, config as never);
  }
  univer.registerPlugin(UniverSlidesPlugin);
  univer.registerPlugin(UniverSlidesUIPlugin);

  return {
    univer,
    commandService: univer.__getInjector().get(ICommandService),
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

const PERSISTENT_SLIDE_COMMAND_IDS = new Set([
  "slide.command.insert-float-image",
  "slide.operation.add-text",
  "slide.operation.append-slide",
  "slide.operation.delete-element",
  "slide.operation.edit-arrow",
  "slide.operation.insert-float-shape.ellipse",
  "slide.operation.insert-float-shape.rectangle",
  "slide.operation.update-element",
]);

function isSlideMutation(command: ICommandInfo, slideId: string) {
  const params = command.params as { unitId?: string } | undefined;
  if (params?.unitId && params.unitId !== slideId) return false;
  return command.type === CommandType.MUTATION || PERSISTENT_SLIDE_COMMAND_IDS.has(command.id);
}

function slideTextEntries(snapshot: ISlideData): SlideTextEntry[] {
  const pages = snapshot.body?.pages ?? {};
  const pageOrder = snapshot.body?.pageOrder ?? Object.keys(pages);
  return pageOrder.flatMap((pageId) =>
    Object.values(pages[pageId]?.pageElements ?? {})
      .filter((element) => element.type === PageElementType.TEXT && element.richText)
      .map((element) => ({
        key: `${pageId}:${element.id}`,
        pageId,
        elementId: element.id,
        text: element.richText?.text ?? element.richText?.rich?.body?.dataStream?.replace(/\r\n$/, "") ?? "",
      }))
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
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const dirtyRef = useRef(false);
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [textEntries, setTextEntries] = useState<SlideTextEntry[]>([]);
  const [selectedTextKey, setSelectedTextKey] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState("");
  const [zoomPercent, setZoomPercent] = useState(100);

  const changeZoom = useCallback((nextPercent: number) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const normalized = Math.max(50, Math.min(200, nextPercent));
    if (!setSlidesRenderZoom(runtime.renderManager, runtime.slideId, normalized / 100)) {
      toast.error("演示文稿画布尚未就绪");
      return;
    }
    setZoomPercent(normalized);
  }, []);

  const markDirty = useCallback(
    (nextDirty: boolean) => {
      if (!path) return;
      dirtyRef.current = nextDirty;
      setStatus(nextDirty ? "dirty" : "ready");
      const nextTitle =
        paramsRef.current?.workbenchVariant === "vscode" || !nextDirty
          ? fileName
          : `${fileName} *`;
      api.setTitle(nextTitle);
      api.updateParameters({
        ...api.getParameters(),
        isDirty: nextDirty,
      });
      paramsRef.current?.onDirtyChange?.(path, nextDirty);
    },
    [api, fileName, path]
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
  }, [markDirty, path, readOnly]);

  const selectTextEntry = useCallback((entry: SlideTextEntry) => {
    const runtime = runtimeRef.current;
    if (runtime) {
      runtime.canvasView.activePage(entry.pageId, runtime.slide.getUnitId());
    }
    setSelectedTextKey(entry.key);
    setTextDraft(entry.text);
  }, []);

  const applyTextEdit = useCallback(() => {
    const runtime = runtimeRef.current;
    const entry = textEntries.find((item) => item.key === selectedTextKey);
    if (!runtime || !entry || entry.text === textDraft) return;
    const pages = runtime.slide.getPages();
    if (!pages) return;
    const page = pages[entry.pageId];
    const element = page?.pageElements[entry.elementId];
    if (!page || !element?.richText) return;
    const nextElement = {
      ...element,
      richText: { ...element.richText, text: textDraft, rich: undefined },
    };
    const nextPage = {
      ...page,
      pageElements: { ...page.pageElements, [entry.elementId]: nextElement },
    };
    runtime.slide.updatePage(entry.pageId, nextPage);
    runtime.canvasView.removeObjectById(entry.elementId, entry.pageId, runtime.slide.getUnitId());
    const object = runtime.canvasView.createObjectToPage(nextElement, entry.pageId, runtime.slide.getUnitId());
    if (object) runtime.canvasView.setObjectActiveByPage(object, entry.pageId, runtime.slide.getUnitId());
    setTextEntries((current) => current.map((item) => item.key === entry.key ? { ...item, text: textDraft } : item));
    markDirty(true);
  }, [markDirty, selectedTextKey, textDraft, textEntries]);

  useEffect(() => {
    void retryCount;
    const container = containerRef.current;
    if (!path || !container) return;

    let disposed = false;

    const cleanupRuntime = () => {
      const runtime = runtimeRef.current;
      runtimeRef.current = null;
      if (!runtime) return;
      runtime.commandDisposable?.dispose();
      runtime.wheelViewportDisposable?.dispose();
      disposeUniverAfterReactCommit(runtime.univer);
    };

    cleanupRuntime();
    setStatus("loading");
    setError(null);
    setTextEntries([]);
    setSelectedTextKey(null);
    setTextDraft("");
    setZoomPercent(100);
    dirtyRef.current = false;

    workspaceApi
      .readBinaryFile(path)
      .then(async (data) => ({
        data,
        snapshot: await bytesToSlideSnapshot(path, data),
      }))
      .then(({ data, snapshot }) => {
        if (disposed) return;
        const { univer, commandService } = createSlidesUniver(container);
        const slide = univer.createUnit<ISlideData, SlideDataModel>(
          UniverInstanceType.UNIVER_SLIDE,
          snapshot
        );
        const slideId = slide.getUnitId();
        const renderManager = univer
          .__getInjector()
          .get(IRenderManagerService) as unknown as SlidesRenderManager;
        const wheelViewportDisposable = installSlidesRenderViewportFallback(
          renderManager,
          slideId
        );
        const canvasView = univer.__getInjector().get(CanvasView);
        const commandDisposable = commandService.onCommandExecuted((command) => {
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
          canvasView,
          renderManager,
          slideId,
          originalBytes: data,
          commandDisposable,
          wheelViewportDisposable,
        };
        const entries = slideTextEntries(snapshot);
        setTextEntries(entries);
        // The Slides render controller finishes wiring its scenes after the
        // unit is created. Initialize the text sidebar state without asking
        // CanvasView to activate the already-active first page during that
        // short registration window.
        if (entries[0]) {
          setSelectedTextKey(entries[0].key);
          setTextDraft(entries[0].text);
        }
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
      <div className="flex h-full min-h-0 w-full">
        <div
          key={`${path}:${retryCount}`}
          ref={containerRef}
          className="min-w-0 flex-1"
          role="application"
          aria-label="演示文稿编辑器工具栏与画布"
        />
        <aside className="flex w-64 shrink-0 flex-col border-l border-border-light bg-[#f7f7f5]">
          <div className="border-b border-border-light bg-white px-3 py-2 text-xs font-semibold text-foreground">幻灯片文字</div>
          <div className="max-h-36 space-y-1 overflow-y-auto p-2">
            {textEntries.map((entry, index) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => selectTextEntry(entry)}
                className={`block w-full rounded-md px-2 py-1.5 text-left text-xs ${selectedTextKey === entry.key ? "bg-primary/10 text-primary" : "bg-white text-foreground hover:bg-muted"}`}
                aria-label={`编辑第 ${index + 1} 个幻灯片文本：${entry.text || "空文本框"}`}
              >
                <span className="block truncate">{index + 1}. {entry.text || "空文本框"}</span>
              </button>
            ))}
          </div>
          {selectedTextKey ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2 border-t border-border-light p-2">
              <textarea
                value={textDraft}
                onChange={(event) => setTextDraft(event.target.value)}
                className="min-h-24 flex-1 resize-none rounded-md border border-border bg-white p-2 text-xs leading-5 text-foreground outline-none focus:border-primary/40"
                aria-label="幻灯片文本内容"
              />
              <button
                type="button"
                onClick={applyTextEdit}
                disabled={textEntries.find((entry) => entry.key === selectedTextKey)?.text === textDraft}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
                aria-label="应用幻灯片文字修改"
              >
                <Check className="size-3.5" />
                应用文字
              </button>
            </div>
          ) : (
            <div className="p-3 text-xs text-muted-foreground">暂无可编辑文本</div>
          )}
          <fieldset className="m-0 flex h-10 min-w-0 shrink-0 items-center justify-between border-0 border-t border-border-light bg-white px-2" aria-label="演示文稿缩放">
            <button type="button" className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40" onClick={() => changeZoom(zoomPercent - 10)} disabled={zoomPercent <= 50} title="缩小" aria-label="缩小演示文稿">
              <Minus className="size-3.5" />
            </button>
            <span className="w-12 text-center text-[11px] tabular-nums text-muted-foreground">{zoomPercent}%</span>
            <button type="button" className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40" onClick={() => changeZoom(zoomPercent + 10)} disabled={zoomPercent >= 200} title="放大" aria-label="放大演示文稿">
              <Plus className="size-3.5" />
            </button>
          </fieldset>
        </aside>
      </div>
    </OfficePanelShell>
  );
}
