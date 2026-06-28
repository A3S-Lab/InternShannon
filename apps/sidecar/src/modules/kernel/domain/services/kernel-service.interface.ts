import { Message } from '../entities/message.entity';
import { Session } from '../entities/session.entity';
import { ApiModule, ApiOperation } from './api-explorer.interface';

export const KERNEL_SERVICE = Symbol('KERNEL_SERVICE');

export type CreateSessionOptions = Record<string, unknown>;

export type SessionCreationResult = {
	session: Session;
	created: boolean;
};

/**
 * Kernel Service Interface
 * Orchestrates a3s-code agent sessions and provides API discovery capabilities
 */
export interface IKernelService {
	createSession(agentId: string | undefined, userId: string, title?: string, cwd?: string, options?: CreateSessionOptions): Promise<Session>;
	createSessionWithStatus(agentId: string | undefined, userId: string, title?: string, cwd?: string, options?: CreateSessionOptions): Promise<SessionCreationResult>;
	updateSession(sessionId: string, patch: Record<string, unknown>): Promise<Session | null>;
	endSession(sessionId: string): Promise<void>;
	getSession(sessionId: string): Promise<Session | null>;
	findSessionByCreationRequest(userId: string, agentId: string | undefined, creationRequestId: string): Promise<Session | null>;
	getUserSessions(
		userId: string,
		limit?: number,
		offset?: number,
		includeAllUsers?: boolean,
		conversationalOnly?: boolean,
	): Promise<Session[]>;
	/** Total session count for accurate pagination — scoped to the user, or all users for platform-bypass callers.
	 * conversationalOnly excludes feature-internal runtime sessions (asset/system). */
	countUserSessions(userId: string, includeAllUsers?: boolean, conversationalOnly?: boolean): Promise<number>;
	getSessionMessages(sessionId: string, limit?: number, offset?: number): Promise<Message[]>;
	getLatestSessionMessageByRole(sessionId: string, role: Message['role']): Promise<Message | null>;
	awaitWorkspaceReady?(sessionId: string): Promise<void>;
	// API Discovery
	listModules(userId: string): Promise<ApiModule[]>;
	getModule(moduleName: string, userId: string): Promise<ApiModule | null>;
	searchOperations(query: string, userId: string): Promise<ApiOperation[]>;
	executeOperation(moduleName: string, operationName: string, params: Record<string, unknown>, userId: string): Promise<unknown>;
}
