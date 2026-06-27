import { Injectable } from "@nestjs/common";
import { KernelSessionRuntimeAccessService } from "./kernel-session-runtime-access.service";

export interface KernelSessionConnectionSubscribeInput {
  clientId: string;
  sessionId: string;
  join: (sessionRoom: string) => void;
  leave: (sessionRoom: string) => void;
  emitSubscribed: (payload: { sessionId: string }) => void;
}

export interface KernelSessionConnectionDisconnectInput {
  clientId: string;
  leave: (sessionRoom: string) => void;
}

@Injectable()
export class KernelSessionConnectionService {
  private readonly clientSessions = new Map<string, string>();
  private readonly sessionClients = new Map<string, Set<string>>();

  constructor(
    private readonly runtimeAccess: KernelSessionRuntimeAccessService
  ) {}

  subscribe(input: KernelSessionConnectionSubscribeInput): void {
    const previousSessionId = this.clientSessions.get(input.clientId);
    if (previousSessionId !== input.sessionId) {
      this.disconnect({
        clientId: input.clientId,
        leave: input.leave,
      });
      input.join(this.sessionRoom(input.sessionId));
      this.clientSessions.set(input.clientId, input.sessionId);
      this.clientsFor(input.sessionId).add(input.clientId);
    }

    input.emitSubscribed({ sessionId: input.sessionId });
  }

  disconnect(input: KernelSessionConnectionDisconnectInput): string | null {
    const sessionId = this.clientSessions.get(input.clientId);
    if (!sessionId) {
      return null;
    }

    input.leave(this.sessionRoom(sessionId));
    this.clientSessions.delete(input.clientId);

    const clients = this.sessionClients.get(sessionId);
    if (!clients) {
      this.runtimeAccess.closeActive(sessionId);
      return sessionId;
    }

    clients.delete(input.clientId);
    if (clients.size === 0) {
      this.sessionClients.delete(sessionId);
      this.runtimeAccess.closeActive(sessionId);
    }

    return sessionId;
  }

  sessionIdForClient(clientId: string): string | undefined {
    return this.clientSessions.get(clientId);
  }

  private clientsFor(sessionId: string): Set<string> {
    const existing = this.sessionClients.get(sessionId);
    if (existing) {
      return existing;
    }
    const clients = new Set<string>();
    this.sessionClients.set(sessionId, clients);
    return clients;
  }

  private sessionRoom(sessionId: string): string {
    return `session:${sessionId}`;
  }
}
