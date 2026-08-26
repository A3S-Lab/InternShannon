interface PendingSessionStatusRequest {
  sessionId: string;
  resolve: (refreshed: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Correlates explicit status requests so background broadcasts cannot satisfy /context. */
export class SessionStatusRequestRegistry {
  private readonly pending = new Map<string, PendingSessionStatusRequest>();

  wait(sessionId: string, requestId: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(requestId);
          resolve(false);
        },
        Math.max(1, timeoutMs),
      );
      this.pending.set(requestId, { sessionId, resolve, timer });
    });
  }

  settle(sessionId: string, requestId: string | undefined, refreshed: boolean): boolean {
    if (!requestId) return false;
    const request = this.pending.get(requestId);
    if (!request || request.sessionId !== sessionId) return false;
    clearTimeout(request.timer);
    this.pending.delete(requestId);
    request.resolve(refreshed);
    return true;
  }

  cancelSession(sessionId: string): void {
    for (const [requestId, request] of this.pending.entries()) {
      if (request.sessionId !== sessionId) continue;
      clearTimeout(request.timer);
      this.pending.delete(requestId);
      request.resolve(false);
    }
  }
}
