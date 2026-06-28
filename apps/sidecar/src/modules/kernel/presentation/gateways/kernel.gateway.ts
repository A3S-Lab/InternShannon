import { Inject, Logger } from '@nestjs/common';
import {
    ConnectedSocket,
    MessageBody,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AgentLifecycleMediator } from '../../application/agent-lifecycle-mediator.service';
import {
    isLockedAgent,
    lockedRunViolation,
    lockedSessionViolation,
} from '../../application/agents/locked-agent.policy';
import { KernelBtwQueryService } from '../../application/kernel-btw-query.service';
import { KernelMessageRunCancellationService } from '../../application/kernel-message-run-cancellation.service';
import { KernelMessageRunIntakeService } from '../../application/kernel-message-run-intake.service';
import { KernelSessionAccessService } from '../../application/kernel-session-access.service';
import { KernelSessionBroadcaster } from '../../application/kernel-session-broadcaster.service';
import { KernelSessionConnectionService } from '../../application/kernel-session-connection.service';
import { KernelSessionResetService } from '../../application/kernel-session-reset.service';
import { KernelSessionRuntimeAccessService } from '../../application/kernel-session-runtime-access.service';
import { KernelSessionSnapshotService } from '../../application/kernel-session-snapshot.service';
import { KernelSessionStatusService } from '../../application/kernel-session-status.service';
import type { MessagePayload, SubscribePayload } from '../../application/session-runtime.types';
import { IKernelService, KERNEL_SERVICE } from '../../domain/services/kernel-service.interface';
import { type ToolConfirmationResponse, WebSocketConfirmationManager } from './websocket-confirmation-manager';

/**
 * Kernel WebSocket Gateway
 * Handles real-time communication with the desktop frontend for agent sessions.
 *
 * Namespace: /ws/kernel
 *
 * Uses @a3s-lab/code for the actual AI agent conversation functionality.
 */
@WebSocketGateway({
    namespace: '/ws/kernel',
    cors: {
        origin: '*',
        credentials: true,
    },
})
export class KernelGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
    @WebSocketServer()
    server: Server = null as unknown as Server;

    private readonly logger = new Logger(KernelGateway.name);

    // HITL Confirmation Manager
    private confirmationManager: WebSocketConfirmationManager | null = null;
    private readonly clientUsers = new Map<string, string>();

    constructor(
        @Inject(KERNEL_SERVICE)
        private readonly kernelService: IKernelService,
        private readonly runtimeAccess: KernelSessionRuntimeAccessService,
        private readonly btwQuery: KernelBtwQueryService,
        private readonly messageRunCancellation: KernelMessageRunCancellationService,
        private readonly messageRunIntake: KernelMessageRunIntakeService,
        private readonly sessionAccess: KernelSessionAccessService,
        private readonly sessionBroadcaster: KernelSessionBroadcaster,
        private readonly sessionConnections: KernelSessionConnectionService,
        private readonly sessionReset: KernelSessionResetService,
        private readonly sessionSnapshot: KernelSessionSnapshotService,
        private readonly sessionStatus: KernelSessionStatusService,
        private readonly agentLifecycle: AgentLifecycleMediator,
    ) {}

    afterInit(): void {
        this.logger.log('Initializing KernelGateway...');

        // Initialize HITL Confirmation Manager
        this.confirmationManager = new WebSocketConfirmationManager(this.server, 60000);
        this.logger.log('HITL Confirmation Manager initialized');

        // Wire the broadcaster bridge so non-kernel services can push raw
        // frames to a session room.
        this.sessionBroadcaster.attach(this.server);

        // Load runtime config for agent configuration
        this.runtimeAccess.refreshRuntimeCatalog().catch(error => {
            this.logger.warn(`Failed to load runtime config: ${error}. Using defaults.`);
        });
    }

    async handleConnection(client: Socket): Promise<void> {
        const userId = await this.resolveSocketUserId(client);
        if (!userId) {
            client.emit('message', { type: 'error', message: '请先登录后再连接内核会话' });
            client.disconnect(true);
            return;
        }
        this.clientUsers.set(client.id, userId);
        this.logger.log(`Client connected: ${client.id} (user=${userId})`);
    }

    handleDisconnect(client: Socket): void {
        this.logger.log(`Client disconnected: ${client.id}`);
        this.clientUsers.delete(client.id);
        const sessionId = this.sessionConnections.sessionIdForClient(client.id);
        this.sessionConnections.disconnect({
            clientId: client.id,
            leave: room => client.leave(room),
        });
        if (sessionId) {
            this.confirmationManager?.cleanup(sessionId);
        }
    }

    private async requireClientSessionAccess(client: Socket, sessionId?: string): Promise<string | null> {
        const userId = await this.resolveClientUserId(client);
        if (!userId || !sessionId) {
            client.emit('message', {
                type: 'error',
                message: 'Session not found or access denied',
            });
            return null;
        }

        try {
            await this.sessionAccess.requireOwnedSession(sessionId, userId);
            return userId;
        } catch {
            client.emit('message', {
                type: 'error',
                message: 'Session not found or access denied',
            });
            client.emit('message', {
                type: 'status_change',
                status: null,
            });
            return null;
        }
    }

    private async resolveClientUserId(client: Socket): Promise<string | null> {
        const cached = this.clientUsers.get(client.id);
        if (cached) return cached;

        const userId = await this.resolveSocketUserId(client);
        if (userId) {
            this.clientUsers.set(client.id, userId);
        }
        return userId;
    }

    private async resolveSocketUserId(client: Socket): Promise<string | null> {
        return 'desktop-user';
    }

    @SubscribeMessage('subscribe')
    async handleSubscribe(@ConnectedSocket() client: Socket, @MessageBody() payload: SubscribePayload): Promise<void> {
        const { sessionId } = payload;
        this.logger.log(`Client ${client.id} subscribing to session ${sessionId}`);
        const userId = await this.requireClientSessionAccess(client, sessionId);
        if (!userId) return;

        this.sessionConnections.subscribe({
            clientId: client.id,
            sessionId,
            join: room => client.join(room),
            leave: room => client.leave(room),
            emitSubscribed: message => client.emit('subscribed', message),
        });

        // Send session state to the client
        await this.emitSessionInit(client, sessionId);
    }

    @SubscribeMessage('message')
    async handleMessage(@ConnectedSocket() client: Socket, @MessageBody() payload: MessagePayload): Promise<void> {
        const { sessionId, type } = payload;
        this.logger.debug(`Message from ${client.id} to session ${sessionId}: type=${type}`);

        try {
            const userId = await this.requireClientSessionAccess(client, sessionId);
            if (!userId) return;
            switch (type) {
                case 'user_message':
                    await this.handleUserMessage(
                        sessionId,
                        payload as {
                            content: string;
                            images?: { mediaType: string; data: string }[];
                            attachments?: {
                                uploadId: string;
                                fileName: string;
                                mimeType?: string;
                                size?: number;
                                sha256?: string;
                            }[];
                            model?: string;
                        },
                    );
                    break;
                case 'interrupt':
                case 'cancel':
                    await this.handleCancel(sessionId);
                    break;
                case 'btw_message':
                case 'btw':
                    await this.handleBtw(sessionId, payload as { content?: string });
                    break;
                case 'set_model':
                    if (await this.rejectLockedSessionOverride(sessionId, { model: payload.model })) {
                        break;
                    }
                    this.runtimeAccess.patchRuntimeOverrides(sessionId, {
                        model: typeof payload.model === 'string' ? payload.model : undefined,
                    });
                    this.broadcastToSession(sessionId, {
                        type: 'session_update',
                        session: { model: payload.model },
                    });
                    break;
                case 'set_permissionMode': {
                    if (await this.rejectLockedSessionOverride(sessionId, { permissionMode: payload.mode })) {
                        break;
                    }
                    const permissionPatch = this.runtimePatchForPermissionMode(payload.mode);
                    this.runtimeAccess.patchRuntimeOverrides(sessionId, permissionPatch);
                    this.broadcastToSession(sessionId, {
                        type: 'session_update',
                        session: permissionPatch,
                    });
                    break;
                }
                case 'set_systemPrompt':
                    if (
                        await this.rejectLockedSessionOverride(sessionId, {
                            systemPrompt: payload.systemPrompt,
                        })
                    ) {
                        break;
                    }
                    this.runtimeAccess.patchRuntimeOverrides(sessionId, {
                        systemPrompt: typeof payload.systemPrompt === 'string' ? payload.systemPrompt : undefined,
                    });
                    break;
                case 'session_status':
                    await this.handleSessionStatus(sessionId);
                    break;
                case 'clear_session':
                    await this.handleClearSession(sessionId);
                    break;
                case 'tool_confirmation_response':
                    await this.handleToolConfirmationResponse(
                        sessionId,
                        payload as unknown as ToolConfirmationResponse,
                    );
                    break;
                case 'send_agent_message':
                    await this.handleAgentMessageRelay(sessionId, payload, userId);
                    break;
                case 'set_autoExecute':
                    await this.handleAutoExecuteChange(sessionId, payload);
                    break;
                default:
                    this.logger.debug(`Unhandled message type: ${type}`);
            }
        } catch (error) {
            this.logger.error(`Unhandled gateway message error for ${sessionId}: ${error}`);
            client.emit('message', {
                type: 'error',
                message: error instanceof Error ? error.message : String(error),
            });
            client.emit('message', {
                type: 'status_change',
                status: null,
            });
        }
    }

    @SubscribeMessage('tool_confirmation_response')
    async handleDirectToolConfirmationResponse(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: ToolConfirmationResponse & { sessionId?: string },
    ): Promise<void> {
        const sessionId = payload.sessionId || this.sessionConnections.sessionIdForClient(client.id);
        if (!sessionId) {
            this.logger.warn(`Tool confirmation response from ${client.id} has no session binding`);
            return;
        }
        if (!(await this.requireClientSessionAccess(client, sessionId))) {
            return;
        }
        await this.handleToolConfirmationResponse(sessionId, payload);
    }

    private async handleAgentMessageRelay(sessionId: string, payload: MessagePayload, userId: string): Promise<void> {
        const targetSessionId = typeof payload.target === 'string' ? payload.target.trim() : '';
        const content = typeof payload.content === 'string' ? payload.content.trim() : '';
        if (!targetSessionId || !content) {
            this.broadcastToSession(sessionId, {
                type: 'error',
                message: 'target and content are required for agent message',
            });
            return;
        }

        try {
            await this.sessionAccess.requireOwnedSession(targetSessionId, userId);
        } catch {
            this.broadcastToSession(sessionId, {
                type: 'error',
                message: 'target session not found or access denied',
            });
            return;
        }

        this.broadcastToSession(targetSessionId, {
            type: 'agent_message',
            messageId: `agent-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            fromSessionId: sessionId,
            topic: typeof payload.topic === 'string' ? payload.topic : 'agent-message',
            content,
            autoExecute: payload.autoExecute === true,
        });
    }

    private async handleAutoExecuteChange(sessionId: string, payload: MessagePayload): Promise<void> {
        const enabled = payload.enabled === true;
        await this.kernelService.updateSession(sessionId, { autoExecute: enabled });
        this.broadcastToSession(sessionId, {
            type: 'session_update',
            session: { autoExecute: enabled },
        });
    }

    private runtimePatchForPermissionMode(mode: unknown): {
        permissionMode?: string;
        planningMode?: string;
        goalTracking?: boolean;
    } {
        const permissionMode = typeof mode === 'string' ? mode : undefined;
        if (permissionMode === 'plan') {
            return { permissionMode, planningMode: 'enabled', goalTracking: true };
        }
        if (permissionMode === 'default' || permissionMode === 'auto') {
            return { permissionMode, planningMode: 'disabled', goalTracking: false };
        }
        return { permissionMode };
    }

    /**
     * Handle tool confirmation response from frontend
     */
    private async handleToolConfirmationResponse(sessionId: string, response: ToolConfirmationResponse): Promise<void> {
        this.logger.log(`Received tool confirmation response for session ${sessionId}: ${response.requestId}`);

        if (!this.confirmationManager) {
            this.logger.error('Confirmation manager not initialized');
            return;
        }

        // Handle the confirmation response
        this.confirmationManager.handleConfirmationResponse(response, sessionId);

        // If approved with scope, store the approval
        if (response.approved && response.scope) {
            // Extract tool name from pending request
            // The confirmation manager will handle scope-based approvals
            this.logger.log(`Tool approved with scope: ${response.scope}`);
        }
    }

    /**
     * Broadcast a message to all clients in a session room
     */
    broadcastToSession(sessionId: string, message: unknown): void {
        this.server.to(`session:${sessionId}`).emit('message', message);
    }

    private async emitSessionInit(client: Socket, sessionId: string): Promise<void> {
        try {
            const snapshot = await this.sessionSnapshot.getSnapshot(sessionId);
            if (!snapshot) {
                return;
            }

            client.emit('message', {
                type: 'session_init',
                session: snapshot.session,
            });

            if (snapshot.messages.length > 0) {
                client.emit('message', {
                    type: 'message_history',
                    messages: snapshot.messages,
                });
            }

            client.emit('message', { type: 'cli_connected' });
        } catch (error) {
            this.logger.error(`Error emitting session init: ${error}`);
        }
    }

    private async handleUserMessage(
        sessionId: string,
        data: {
            content: string;
            images?: { mediaType: string; data: string }[];
            attachments?: { uploadId: string; fileName: string; mimeType?: string; size?: number; sha256?: string }[];
            model?: string;
        },
    ): Promise<void> {
        const session = await this.kernelService.getSession(sessionId);
        const violation = lockedRunViolation(session?.agentId, { model: data.model });
        if (violation) {
            this.broadcastToSession(sessionId, {
                type: 'error',
                message: violation,
            });
            this.broadcastToSession(sessionId, {
                type: 'status_change',
                status: null,
            });
            return;
        }
        const locked = isLockedAgent(session?.agentId);

        if (data.attachments?.length) {
            await this.processAttachments(sessionId, data.attachments, session?.userId);
        }

        await this.messageRunIntake.run({
            sessionId,
            content: data.content,
            images: data.images,
            model: locked ? undefined : data.model,
            confirmation: this.confirmationManager,
            emit: message => this.broadcastToSession(sessionId, message),
        });
    }

    private async rejectLockedSessionOverride(
        sessionId: string,
        payload: {
            model?: unknown;
            permissionMode?: unknown;
            planningMode?: unknown;
            goalTracking?: unknown;
            systemPrompt?: unknown;
        },
    ): Promise<boolean> {
        const session = await this.kernelService.getSession(sessionId);
        const violation = lockedSessionViolation(session?.agentId, payload);
        if (!violation) return false;

        this.broadcastToSession(sessionId, {
            type: 'error',
            message: violation,
        });
        this.broadcastToSession(sessionId, {
            type: 'status_change',
            status: null,
        });
        return true;
    }

    private async processAttachments(
        sessionId: string,
        attachments: Array<{ uploadId: string; fileName: string; mimeType?: string; size?: number; sha256?: string }>,
        userId?: string,
    ): Promise<void> {
        const activeSession = this.runtimeAccess.active(sessionId);
        const agentId = activeSession?.agentId || 'default';

        for (const attachment of attachments) {
            await this.agentLifecycle.dispatchFileAttached({
                sessionId,
                agentId,
                userId: userId || activeSession?.userId || 'desktop-user',
                upload: {
                    uploadId: attachment.uploadId,
                    fileName: attachment.fileName,
                    mimeType: attachment.mimeType,
                    size: attachment.size || 0,
                    sha256: attachment.sha256 || '',
                    path: '',
                },
            });

            this.broadcastToSession(sessionId, {
                type: 'file_attached',
                uploadId: attachment.uploadId,
                fileName: attachment.fileName,
                mimeType: attachment.mimeType,
            });
        }
    }

    private async handleCancel(sessionId: string): Promise<void> {
        await this.messageRunCancellation.cancel({
            sessionId,
            emit: message => this.broadcastToSession(sessionId, message),
        });
    }

    private async handleBtw(sessionId: string, data: { content?: string }): Promise<void> {
        await this.btwQuery.ask({
            sessionId,
            content: data.content,
            emit: message => this.broadcastToSession(sessionId, message),
        });
    }

    private async handleClearSession(sessionId: string): Promise<void> {
        await this.sessionReset.reset(sessionId);

        this.broadcastToSession(sessionId, {
            type: 'command_response',
            command: '/clear',
            text: '已清空当前会话记录',
            stateChanged: true,
        });
        this.broadcastToSession(sessionId, {
            type: 'status_change',
            status: null,
        });
        this.broadcastToSession(sessionId, {
            type: 'cli_connected',
        });
    }

    private async handleSessionStatus(sessionId: string): Promise<void> {
        try {
            const activeSession = await this.runtimeAccess.getActiveOrCreate({
                sessionId,
                emit: message => this.broadcastToSession(sessionId, message),
            });
            if (!activeSession) {
                this.broadcastToSession(sessionId, {
                    type: 'error',
                    message: 'Failed to access session',
                });
                this.broadcastToSession(sessionId, {
                    type: 'status_change',
                    status: null,
                });
                return;
            }
            const runtimeOverrides = {
                ...activeSession.runtimeOverrides,
                ...this.runtimeAccess.runtimeOverrides(sessionId),
            };
            this.broadcastToSession(sessionId, {
                type: 'session_status',
                data: await this.sessionStatus.describe(activeSession, runtimeOverrides),
            });
        } catch (error) {
            this.logger.error(`Failed to read session status for ${sessionId}: ${error}`);
            this.broadcastToSession(sessionId, {
                type: 'error',
                message: error instanceof Error ? error.message : String(error),
            });
            this.broadcastToSession(sessionId, {
                type: 'status_change',
                status: null,
            });
        }
    }
}
