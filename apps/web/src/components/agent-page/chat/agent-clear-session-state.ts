import type { AgentInputFooterActionError } from "./agent-input-send-state";

export type ClearSessionDeliveryAction = "reset-local" | "keep-local";

export interface ClearSessionDeliveryInput {
  sent: boolean;
}

export interface ClearSessionDeliveryState {
  action: ClearSessionDeliveryAction;
  actionError: AgentInputFooterActionError | null;
  toastMessage: string | null;
}

export function resolveClearSessionDeliveryState(input: ClearSessionDeliveryInput): ClearSessionDeliveryState {
  if (input.sent) {
    return {
      action: "reset-local",
      actionError: null,
      toastMessage: null,
    };
  }

  return {
    action: "keep-local",
    actionError: {
      message: "清空请求未送达，本地对话未清除。请恢复连接后重试。",
      dismissLabel: "关闭清空错误提示",
    },
    toastMessage: "清空失败，请检查本地服务连接",
  };
}
