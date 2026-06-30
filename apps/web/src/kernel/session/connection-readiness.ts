export type SessionSocketConnectionStatus = "connecting" | "connected" | "disconnected" | undefined;

export function subscribedPayloadMatchesSession(payload: unknown, sessionId: string): boolean {
  const subscribedSessionId =
    payload && typeof payload === "object" && "sessionId" in payload
      ? String((payload as { sessionId?: unknown }).sessionId ?? "")
      : "";
  return !subscribedSessionId || subscribedSessionId === sessionId;
}

export function canSendSessionSocketMessage(input: {
  socketConnected?: boolean;
  connectionStatus?: SessionSocketConnectionStatus;
}): boolean {
  return input.socketConnected === true && input.connectionStatus === "connected";
}
