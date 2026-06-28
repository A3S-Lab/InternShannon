export interface ToolConfirmationDialogFeedbackInput {
  pending: boolean;
  deliveryError?: string | null;
}

export interface ToolConfirmationDialogFeedback {
  tone: "info" | "error";
  title: string;
  message: string;
  role: "status" | "alert";
  ariaLive: "polite" | "assertive";
}

export function resolveToolConfirmationDialogFeedback(
  input: ToolConfirmationDialogFeedbackInput,
): ToolConfirmationDialogFeedback | null {
  if (input.pending) {
    return {
      tone: "info",
      title: "正在发送确认",
      message: "正在把授权响应发送到本地运行时。",
      role: "status",
      ariaLive: "polite",
    };
  }

  const message = input.deliveryError?.trim();
  if (!message) return null;
  return {
    tone: "error",
    title: "授权响应未送达",
    message,
    role: "alert",
    ariaLive: "assertive",
  };
}
