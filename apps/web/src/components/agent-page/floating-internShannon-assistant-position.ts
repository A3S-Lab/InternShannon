export type AssistantPoint = {
  x: number;
  y: number;
};

export type AssistantViewportSize = {
  width: number;
  height: number;
};

export type AssistantRect = AssistantPoint & {
  width: number;
  height: number;
};

export type AssistantPanelTransformPhase = "collapsed" | "expanded";

export type AssistantPanelTransform = AssistantPoint & {
  scale: number;
  transform: string;
  transformOrigin: string;
};

export const INTERNSHANNON_ASSISTANT_BUBBLE_POSITION_STORAGE_KEY = "internShannon-assistant:bubble-position";
export const INTERNSHANNON_ASSISTANT_BUBBLE_SIZE = 56;
export const INTERNSHANNON_ASSISTANT_BUBBLE_MARGIN = 24;
export const INTERNSHANNON_ASSISTANT_BUBBLE_MOBILE_MARGIN = 12;
export const INTERNSHANNON_ASSISTANT_BUBBLE_MOBILE_BOTTOM_CLEARANCE = 96;
export const INTERNSHANNON_ASSISTANT_BUBBLE_POSITION_VERSION = 2;
const INTERNSHANNON_ASSISTANT_PANEL_MIN_COLLAPSED_SCALE = 0.045;
const INTERNSHANNON_ASSISTANT_PANEL_MAX_COLLAPSED_SCALE = 0.16;
const INTERNSHANNON_ASSISTANT_BUBBLE_LEGACY_DEFAULT_TOLERANCE = 24;

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function bubbleMarginForViewport(viewport: AssistantViewportSize) {
  return viewport.width < 720 ? INTERNSHANNON_ASSISTANT_BUBBLE_MOBILE_MARGIN : INTERNSHANNON_ASSISTANT_BUBBLE_MARGIN;
}

function isAssistantPoint(value: unknown): value is AssistantPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<AssistantPoint>;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function hasCurrentBubblePositionVersion(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return (value as { version?: unknown }).version === INTERNSHANNON_ASSISTANT_BUBBLE_POSITION_VERSION;
}

function isLegacyMobileBottomRightPosition(point: AssistantPoint, viewport: AssistantViewportSize): boolean {
  if (viewport.width >= 720) return false;
  const clampedPoint = constrainAssistantBubblePosition(point, viewport);
  const right = viewport.width - clampedPoint.x - INTERNSHANNON_ASSISTANT_BUBBLE_SIZE;
  const bottom = viewport.height - clampedPoint.y - INTERNSHANNON_ASSISTANT_BUBBLE_SIZE;
  return (
    right <= INTERNSHANNON_ASSISTANT_BUBBLE_MOBILE_MARGIN + INTERNSHANNON_ASSISTANT_BUBBLE_LEGACY_DEFAULT_TOLERANCE &&
    bottom <= INTERNSHANNON_ASSISTANT_BUBBLE_MOBILE_MARGIN + INTERNSHANNON_ASSISTANT_BUBBLE_LEGACY_DEFAULT_TOLERANCE
  );
}

export function constrainAssistantBubblePosition(
  position: AssistantPoint,
  viewport: AssistantViewportSize,
): AssistantPoint {
  const margin = bubbleMarginForViewport(viewport);
  return {
    x: clampNumber(position.x, margin, Math.max(margin, viewport.width - INTERNSHANNON_ASSISTANT_BUBBLE_SIZE - margin)),
    y: clampNumber(position.y, margin, Math.max(margin, viewport.height - INTERNSHANNON_ASSISTANT_BUBBLE_SIZE - margin)),
  };
}

export function createDefaultAssistantBubblePosition(viewport: AssistantViewportSize): AssistantPoint {
  const margin = bubbleMarginForViewport(viewport);
  const bottomClearance =
    viewport.width < 720 ? INTERNSHANNON_ASSISTANT_BUBBLE_MOBILE_BOTTOM_CLEARANCE : INTERNSHANNON_ASSISTANT_BUBBLE_MARGIN;
  return constrainAssistantBubblePosition(
    {
      x: viewport.width - INTERNSHANNON_ASSISTANT_BUBBLE_SIZE - margin,
      y: viewport.height - INTERNSHANNON_ASSISTANT_BUBBLE_SIZE - bottomClearance,
    },
    viewport,
  );
}

export function resolveStoredAssistantBubblePosition(
  storedPosition: unknown,
  viewport: AssistantViewportSize,
): AssistantPoint | null {
  if (!isAssistantPoint(storedPosition)) return null;
  if (!hasCurrentBubblePositionVersion(storedPosition) && isLegacyMobileBottomRightPosition(storedPosition, viewport)) {
    return null;
  }
  return constrainAssistantBubblePosition(storedPosition, viewport);
}

export function assistantBubbleCenter(position: AssistantPoint): AssistantPoint {
  const radius = INTERNSHANNON_ASSISTANT_BUBBLE_SIZE / 2;
  return {
    x: position.x + radius,
    y: position.y + radius,
  };
}

export function resolveAssistantPanelTransformOrigin(
  bubblePosition: AssistantPoint,
  panelRect: AssistantRect,
): AssistantPoint {
  const center = assistantBubbleCenter(bubblePosition);
  return {
    x: center.x - panelRect.x,
    y: center.y - panelRect.y,
  };
}

export function resolveAssistantPanelCollapsedScale(panelRect: Pick<AssistantRect, "width" | "height">): number {
  const largestPanelEdge = Math.max(panelRect.width, panelRect.height, INTERNSHANNON_ASSISTANT_BUBBLE_SIZE);
  return clampNumber(
    INTERNSHANNON_ASSISTANT_BUBBLE_SIZE / largestPanelEdge,
    INTERNSHANNON_ASSISTANT_PANEL_MIN_COLLAPSED_SCALE,
    INTERNSHANNON_ASSISTANT_PANEL_MAX_COLLAPSED_SCALE,
  );
}

export function resolveAssistantPanelTransform(
  bubblePosition: AssistantPoint,
  panelRect: AssistantRect,
  phase: AssistantPanelTransformPhase,
): AssistantPanelTransform {
  if (phase === "expanded") {
    return {
      x: panelRect.x,
      y: panelRect.y,
      scale: 1,
      transform: `translate3d(${panelRect.x}px, ${panelRect.y}px, 0) scale(1)`,
      transformOrigin: "0 0",
    };
  }

  const center = assistantBubbleCenter(bubblePosition);
  const scale = resolveAssistantPanelCollapsedScale(panelRect);
  const x = center.x - (panelRect.width * scale) / 2;
  const y = center.y - (panelRect.height * scale) / 2;

  return {
    x,
    y,
    scale,
    transform: `translate3d(${x}px, ${y}px, 0) scale(${scale})`,
    transformOrigin: "0 0",
  };
}
