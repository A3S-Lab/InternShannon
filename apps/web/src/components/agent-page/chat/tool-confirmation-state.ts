export type ToolConfirmationDeliveryAction = "clear" | "keep";

export interface ToolConfirmationDeliveryInput {
  sent: boolean;
}

export function resolveToolConfirmationDeliveryAction(
  input: ToolConfirmationDeliveryInput,
): ToolConfirmationDeliveryAction {
  return input.sent ? "clear" : "keep";
}

export function formatToolConfirmationDeliveryError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  if (typeof error === "object" && error && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "").trim();
    if (message) return message;
  }
  return fallback;
}

export interface ToolConfirmationDialogDeliveryErrorInput {
  requestId?: string | null;
  deliveryError?: { requestId?: string | null; message?: string | null } | null;
}

export function resolveToolConfirmationDialogDeliveryError(
  input: ToolConfirmationDialogDeliveryErrorInput,
): string | null {
  const requestId = input.requestId?.trim();
  if (!requestId) return null;
  if (!input.deliveryError || input.deliveryError.requestId !== requestId) return null;

  const message = input.deliveryError.message?.trim();
  return message || null;
}
