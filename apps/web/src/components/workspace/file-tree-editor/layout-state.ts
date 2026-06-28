export type FileTreeEditorVariant = "default" | "vscode";

export interface FileTreePanelLayoutInput {
  variant: FileTreeEditorVariant;
  containerWidth: number | null;
  fullWidthSidebar: boolean;
  sidebarDefaultSize: number;
  sidebarMinSize: number;
  sidebarMaxSize: number;
}

export interface FileTreePanelLayout {
  mode: "normal" | "compact" | "full-width";
  sidebarDefaultSize: number;
  sidebarMinSize: number;
  sidebarMaxSize: number;
  editorDefaultSize: number;
  editorMinSize: number;
}

const COMPACT_WORKBENCH_MAX_WIDTH = 520;
const COMPACT_SIDEBAR_DEFAULT_SIZE = 58;
const COMPACT_SIDEBAR_MIN_SIZE = 50;
const COMPACT_SIDEBAR_MAX_SIZE = 68;
const NORMAL_EDITOR_MIN_SIZE = 40;
const COMPACT_EDITOR_MIN_SIZE = 24;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveBoundedSidebarDefaultSize(input: {
  defaultSize: number;
  minSize: number;
  maxSize: number;
  editorMinSize: number;
}): number {
  return clamp(input.defaultSize, input.minSize, Math.min(input.maxSize, 100 - input.editorMinSize));
}

export function resolveFileTreePanelLayout(input: FileTreePanelLayoutInput): FileTreePanelLayout {
  if (input.fullWidthSidebar) {
    return {
      mode: "full-width",
      sidebarDefaultSize: 100,
      sidebarMinSize: 100,
      sidebarMaxSize: 100,
      editorDefaultSize: 0,
      editorMinSize: 0,
    };
  }

  const compact =
    input.variant === "vscode" &&
    input.containerWidth !== null &&
    input.containerWidth > 0 &&
    input.containerWidth <= COMPACT_WORKBENCH_MAX_WIDTH;

  if (compact) {
    const sidebarMinSize = Math.max(input.sidebarMinSize, COMPACT_SIDEBAR_MIN_SIZE);
    const sidebarMaxSize = Math.max(input.sidebarMaxSize, COMPACT_SIDEBAR_MAX_SIZE);
    const sidebarDefaultSize = resolveBoundedSidebarDefaultSize({
      defaultSize: Math.max(input.sidebarDefaultSize, COMPACT_SIDEBAR_DEFAULT_SIZE),
      minSize: sidebarMinSize,
      maxSize: sidebarMaxSize,
      editorMinSize: COMPACT_EDITOR_MIN_SIZE,
    });

    return {
      mode: "compact",
      sidebarDefaultSize,
      sidebarMinSize,
      sidebarMaxSize,
      editorDefaultSize: 100 - sidebarDefaultSize,
      editorMinSize: COMPACT_EDITOR_MIN_SIZE,
    };
  }

  const sidebarDefaultSize = clamp(input.sidebarDefaultSize, input.sidebarMinSize, input.sidebarMaxSize);

  return {
    mode: "normal",
    sidebarDefaultSize,
    sidebarMinSize: input.sidebarMinSize,
    sidebarMaxSize: input.sidebarMaxSize,
    editorDefaultSize: Math.max(100 - sidebarDefaultSize, 100 - input.sidebarMaxSize),
    editorMinSize: NORMAL_EDITOR_MIN_SIZE,
  };
}
