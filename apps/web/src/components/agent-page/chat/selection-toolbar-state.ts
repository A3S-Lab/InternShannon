export type SelectionToolbarRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type SelectionToolbarSize = {
  width: number;
  height: number;
};

export type SelectionToolbarPosition = {
  left: number;
  top: number;
  placement: "above" | "below";
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function resolveSelectionToolbarPosition(options: {
  selectionRect: SelectionToolbarRect;
  toolbarSize: SelectionToolbarSize;
  viewportSize: SelectionToolbarSize;
  gap?: number;
  margin?: number;
}): SelectionToolbarPosition {
  const { selectionRect, toolbarSize, viewportSize } = options;
  const gap = options.gap ?? 8;
  const margin = options.margin ?? 8;
  const maximumLeft = viewportSize.width - toolbarSize.width - margin;
  const maximumTop = viewportSize.height - toolbarSize.height - margin;
  const left = clamp(selectionRect.left + selectionRect.width / 2 - toolbarSize.width / 2, margin, maximumLeft);
  const requiredSpace = toolbarSize.height + gap;
  const spaceAbove = selectionRect.top - margin;
  const spaceBelow = viewportSize.height - selectionRect.bottom - margin;
  const placement = spaceAbove >= requiredSpace || spaceAbove >= spaceBelow ? "above" : "below";
  const preferredTop =
    placement === "above" ? selectionRect.top - gap - toolbarSize.height : selectionRect.bottom + gap;

  return {
    left,
    top: clamp(preferredTop, margin, maximumTop),
    placement,
  };
}
