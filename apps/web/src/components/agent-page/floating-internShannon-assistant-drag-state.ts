export type AssistantBubblePointerLike = {
  button: number;
  pointerType?: string;
  isPrimary?: boolean;
};

export function canStartAssistantBubbleDrag(event: AssistantBubblePointerLike): boolean {
  if (event.isPrimary === false) return false;
  if (!event.pointerType || event.pointerType === "mouse") return event.button === 0;
  return event.button <= 0;
}
