import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import {
	IWorkspaceStorage,
	WORKSPACE_STORAGE,
} from '../domain/services/workspace-storage.interface';
import { KernelSessionAccessService } from './kernel-session-access.service';
import { AgentLifecycleMediator } from './agent-lifecycle-mediator.service';
import { normalizeMultipartFileName } from './multipart-file-name';
import { CONFIG_SERVICE, ConfigService } from '@/modules/config/domain/services/config-service.interface';
import { DEFAULT_UPLOAD_MAX_WORKSPACE_FILE_MB } from '@/modules/config/domain/services/settings-schema';

export type SessionWorkspaceUploadConflictStrategy = 'overwrite' | 'rename';
type SessionWorkspaceChunkAddressing = 'offset' | 'index';

export interface SessionWorkspaceUploadFileInput {
	sessionId: string;
	userId?: string | null;
	path: string;
	fileName: string;
	mimeType?: string;
	size: number;
	buffer: Buffer;
	conflictStrategy?: SessionWorkspaceUploadConflictStrategy;
}

export interface SessionWorkspaceUploadFileResult {
	success: true;
	message: string;
	uploadId: string;
	path: string;
	workspacePath: string;
	fileName: string;
	size: number;
	mimeType?: string;
	sha256: string;
}

export interface SessionWorkspaceCreateChunkedUploadInput {
	sessionId: string;
	userId?: string | null;
	path: string;
	fileName: string;
	mimeType?: string;
	size: number;
	chunkSize?: number;
	chunkCount?: number;
	chunkAddressing?: SessionWorkspaceChunkAddressing;
	conflictStrategy?: SessionWorkspaceUploadConflictStrategy;
}

export interface SessionWorkspaceUploadChunkInput {
	sessionId: string;
	userId?: string | null;
	uploadId: string;
	chunkIndex?: number;
	offset?: number;
	totalChunks?: number;
	buffer: Buffer;
}

export interface SessionWorkspaceUploadChunkedFileInput {
	sessionId: string;
	userId?: string | null;
	uploadId?: string;
	path?: string;
	fileName?: string;
	mimeType?: string;
	size?: number;
	chunkSize?: number;
	chunkCount?: number;
	conflictStrategy?: SessionWorkspaceUploadConflictStrategy;
	chunkIndex?: number;
	offset?: number;
	totalChunks?: number;
	buffer: Buffer;
}

export interface SessionWorkspaceChunkedUploadRefInput {
	sessionId: string;
	userId?: string | null;
	uploadId: string;
}

export interface SessionWorkspaceChunkedUploadProgress {
	uploadId: string;
	status: 'uploading' | 'completed';
	path: string;
	fileName: string;
	size: number;
	mimeType?: string;
	chunkSize?: number;
	chunkCount?: number;
	receivedChunks: number;
	uploadedBytes: number;
	progress: number;
	completed: boolean;
	result?: SessionWorkspaceUploadFileResult;
}

interface ChunkedUploadMetadata {
	uploadId: string;
	sessionId: string;
	userId?: string | null;
	workspaceRoot: string;
	relativePath: string;
	fileName: string;
	mimeType?: string;
	size: number;
	chunkSize?: number;
	chunkCount?: number;
	chunkAddressing?: SessionWorkspaceChunkAddressing;
	conflictStrategy?: SessionWorkspaceUploadConflictStrategy;
	receivedChunks: Record<string, number>;
	status: 'uploading' | 'completed';
	result?: SessionWorkspaceUploadFileResult;
	createdAt: string;
	updatedAt: string;
}

@Injectable()
export class SessionWorkspaceFileUploadService {
	constructor(
		@Inject(WORKSPACE_STORAGE) private readonly storage: IWorkspaceStorage,
		private readonly sessionAccess: KernelSessionAccessService,
		@Optional() private readonly agentLifecycle?: AgentLifecycleMediator,
		// 上传大小上限来自平台配置;@Optional 容忍 ConfigModule 不可用(如桌面端)时回退默认。
		@Optional() @Inject(CONFIG_SERVICE) private readonly config?: ConfigService,
	) {}

	/** 工作区上传大小上限(MB)由平台配置 platform.uploadMaxWorkspaceFileMb 决定(默认 512);
	 *  config 不可用时回退默认。单发 + 分片(分片路径绕过 multer 上限,这里是唯一的体积闸)两路都会调。 */
	private async assertWithinWorkspaceMax(sizeBytes: number): Promise<void> {
		const maxMb =
			(await this.config?.getSettings())?.platform.uploadMaxWorkspaceFileMb ?? DEFAULT_UPLOAD_MAX_WORKSPACE_FILE_MB;
		if (sizeBytes > maxMb * 1024 * 1024) {
			throw new BadRequestException(`文件超过工作区上传上限 ${maxMb}MB`);
		}
	}

	async uploadFile(input: SessionWorkspaceUploadFileInput): Promise<SessionWorkspaceUploadFileResult> {
		const session = await this.sessionAccess.requireOwnedSession(input.sessionId, input.userId);
		const workspaceRoot = session.cwd?.trim();
		if (!workspaceRoot) {
			throw new BadRequestException('session workspace is not configured');
		}
		const buffer = this.fileBuffer(input.buffer);
		await this.assertWithinWorkspaceMax(buffer.length);
		const requestedPath = this.safeRelativePath(input.path);
		const relativePath =
			input.conflictStrategy === 'rename'
				? await this.nextAvailableRelativePath(workspaceRoot, requestedPath)
				: requestedPath;
		const uploadId = this.nextId();
		const fileName = normalizeMultipartFileName(input.fileName) || path.posix.basename(relativePath);
		return this.writeFinalFile({
			sessionId: input.sessionId,
			session,
			uploadId,
			workspaceRoot,
			relativePath,
			fileName,
			mimeType: input.mimeType?.trim() || undefined,
			size: input.size || buffer.length,
			buffer,
		});
	}

	async createChunkedUpload(
		input: SessionWorkspaceCreateChunkedUploadInput,
	): Promise<SessionWorkspaceChunkedUploadProgress> {
		const session = await this.sessionAccess.requireOwnedSession(input.sessionId, input.userId);
		const workspaceRoot = session.cwd?.trim();
		if (!workspaceRoot) {
			throw new BadRequestException('session workspace is not configured');
		}
		if (input.conflictStrategy && input.conflictStrategy !== 'overwrite' && input.conflictStrategy !== 'rename') {
			throw new BadRequestException('invalid conflictStrategy');
		}
		const size = this.nonNegativeInteger(input.size, 'size');
		await this.assertWithinWorkspaceMax(size);
		const requestedPath = this.safeRelativePath(input.path);
		const relativePath =
			input.conflictStrategy === 'rename'
				? await this.nextAvailableRelativePath(workspaceRoot, requestedPath)
				: requestedPath;
		const uploadId = this.nextId();
		const now = new Date().toISOString();
		const fileName = normalizeMultipartFileName(input.fileName)?.trim() || path.posix.basename(relativePath);
		const metadata: ChunkedUploadMetadata = {
			uploadId,
			sessionId: input.sessionId,
			userId: input.userId,
			workspaceRoot,
			relativePath,
			fileName,
			mimeType: input.mimeType?.trim() || undefined,
			size,
			chunkSize: input.chunkSize === undefined ? undefined : this.positiveInteger(input.chunkSize, 'chunkSize'),
			// offset 寻址下网络分片数与声明的 chunkCount 无约束关系;若持久化它,完成判定会误走
			// “个数”分支(receivedChunks===chunkCount)而非“字节”分支,致自动完成永不触发、文件不落盘
			// (列表查不到)。只有 index 寻址按 chunkCount 组装,故 offset 模式不记录 chunkCount。
			chunkCount:
				(input.chunkAddressing ?? 'offset') === 'offset' || input.chunkCount === undefined
					? undefined
					: this.positiveInteger(input.chunkCount, 'chunkCount'),
			chunkAddressing: input.chunkAddressing ?? 'offset',
			conflictStrategy: input.conflictStrategy,
			receivedChunks: {},
			status: 'uploading',
			createdAt: now,
			updatedAt: now,
		};
		await this.writeChunkMetadata(metadata);
		return this.toProgress(metadata);
	}

	async uploadChunkedFile(
		input: SessionWorkspaceUploadChunkedFileInput,
	): Promise<SessionWorkspaceChunkedUploadProgress> {
		const initialUploadId = input.uploadId?.trim();
		const uploadId = initialUploadId || (await this.createChunkedUpload({
			sessionId: input.sessionId,
			userId: input.userId,
			path: input.path ?? '',
			fileName: input.fileName ?? '',
			mimeType: input.mimeType,
			size: input.size === undefined ? this.missingInteger('size') : input.size,
			chunkSize: input.chunkSize,
			chunkCount: input.chunkCount ?? input.totalChunks,
			chunkAddressing: this.resolveChunkAddressing(input),
			conflictStrategy: input.conflictStrategy,
		})).uploadId;
		const progress = await this.uploadChunk({
			sessionId: input.sessionId,
			userId: input.userId,
			uploadId,
			chunkIndex: input.chunkIndex,
			offset: input.offset,
			totalChunks: input.totalChunks ?? input.chunkCount,
			buffer: input.buffer,
		});
		if (progress.status === 'uploading' && this.isProgressReadyToComplete(progress)) {
			return this.completeChunkedUpload({
				sessionId: input.sessionId,
				userId: input.userId,
				uploadId,
			});
		}
		return progress;
	}

	async uploadChunk(input: SessionWorkspaceUploadChunkInput): Promise<SessionWorkspaceChunkedUploadProgress> {
		const metadata = await this.readChunkMetadata(input.uploadId);
		await this.assertChunkAccess(metadata, input.sessionId, input.userId);
		if (metadata.status === 'completed') {
			return this.toProgress(metadata);
		}
		const addressing = metadata.chunkAddressing ?? 'index';
		if (input.totalChunks !== undefined) {
			const totalChunks = this.positiveInteger(input.totalChunks, 'totalChunks');
			// offset 寻址只把 totalChunks 当兼容性提示:校验它是正整数,但既不比对也不持久化
			// (offset 完成靠连续字节达到 size,记录 chunkCount 会让完成判定误走个数分支)。
			if (addressing !== 'offset') {
				if (metadata.chunkCount !== undefined && metadata.chunkCount !== totalChunks) {
					throw new BadRequestException('totalChunks does not match the upload session');
				}
				metadata.chunkCount = totalChunks;
			}
		}
		const buffer = this.fileBuffer(input.buffer);
		const chunkKey = addressing === 'offset'
			? String(this.resolveChunkOffset(metadata, input.offset, buffer.length))
			: String(this.resolveChunkIndex(metadata, input.chunkIndex));
		await this.storage.writeBinaryFile(await this.chunkFilePath(metadata.uploadId, chunkKey), buffer);
		metadata.receivedChunks[chunkKey] = buffer.length;
		metadata.updatedAt = new Date().toISOString();
		await this.writeChunkMetadata(metadata);
		return this.toProgress(metadata);
	}

	async getChunkedUpload(input: SessionWorkspaceChunkedUploadRefInput): Promise<SessionWorkspaceChunkedUploadProgress> {
		const metadata = await this.readChunkMetadata(input.uploadId);
		await this.assertChunkAccess(metadata, input.sessionId, input.userId);
		return this.toProgress(metadata);
	}

	async completeChunkedUpload(
		input: SessionWorkspaceChunkedUploadRefInput,
	): Promise<SessionWorkspaceChunkedUploadProgress> {
		const metadata = await this.readChunkMetadata(input.uploadId);
		const session = await this.assertChunkAccess(metadata, input.sessionId, input.userId);
		if (metadata.status === 'completed') {
			return this.toProgress(metadata);
		}
		const addressing = metadata.chunkAddressing ?? 'index';
		const chunkKeys = addressing === 'offset'
			? this.completeOffsetChunkKeys(metadata)
			: this.completeIndexedChunkKeys(metadata);
		const chunks = await Promise.all(
			chunkKeys.map(async key => this.storage.readBinaryFile(await this.chunkFilePath(metadata.uploadId, key))),
		);
		const buffer = Buffer.concat(chunks);
		if (buffer.length !== metadata.size) {
			throw new BadRequestException('uploaded size does not match declared file size');
		}
		const result = await this.writeFinalFile({
			sessionId: metadata.sessionId,
			session,
			uploadId: metadata.uploadId,
			workspaceRoot: metadata.workspaceRoot,
			relativePath: metadata.relativePath,
			fileName: metadata.fileName,
			mimeType: metadata.mimeType,
			size: metadata.size,
			buffer,
		});
		metadata.status = 'completed';
		metadata.result = result;
		metadata.updatedAt = new Date().toISOString();
		// Drop the whole staging prefix (metadata + all parts) in one shot; storage
		// remove() is recursive. Best-effort: a stale staging key must never fail an
		// otherwise-successful upload, and the final file is already written above.
		await this.storage.remove(await this.chunkDir(metadata.uploadId)).catch(() => undefined);
		return this.toProgress(metadata);
	}

	private async writeFinalFile(input: {
		sessionId: string;
		session: { agentId?: string; userId?: string };
		uploadId: string;
		workspaceRoot: string;
		relativePath: string;
		fileName: string;
		mimeType?: string;
		size: number;
		buffer: Buffer;
	}): Promise<SessionWorkspaceUploadFileResult> {
		const workspacePath = this.joinWorkspacePath(input.workspaceRoot, input.relativePath);
		const parent = this.parentWorkspacePath(workspacePath);
		const sha256 = createHash('sha256').update(input.buffer).digest('hex');

		await this.storage.mkdir(parent);
		await this.storage.writeBinaryFile(workspacePath, input.buffer);

		const result: SessionWorkspaceUploadFileResult = {
			success: true,
			message: 'File uploaded successfully',
			uploadId: input.uploadId,
			path: input.relativePath,
			workspacePath,
			fileName: input.fileName,
			size: input.size || input.buffer.length,
			mimeType: input.mimeType,
			sha256,
		};

		if (this.agentLifecycle) {
			if (!input.session.userId) {
				throw new BadRequestException('session user is not configured');
			}
			await this.agentLifecycle.dispatchFileAttached({
				sessionId: input.sessionId,
				agentId: input.session.agentId || 'default',
				userId: input.session.userId,
				upload: {
					uploadId: input.uploadId,
					fileName: result.fileName,
					mimeType: result.mimeType,
					size: result.size,
					sha256,
					path: input.relativePath,
				},
			});
		}

		return result;
	}

	private async nextAvailableRelativePath(workspaceRoot: string, requestedPath: string): Promise<string> {
		if (!(await this.storage.exists(this.joinWorkspacePath(workspaceRoot, requestedPath)).catch(() => false))) {
			return requestedPath;
		}

		const directory = path.posix.dirname(requestedPath);
		const baseName = path.posix.basename(requestedPath);
		const extension = path.posix.extname(baseName);
		const stem = extension ? baseName.slice(0, -extension.length) : baseName;
		const prefix = directory === '.' ? '' : `${directory}/`;

		for (let index = 2; index <= 1000; index += 1) {
			const candidate = `${prefix}${stem}-${index}${extension}`;
			const candidateWorkspacePath = this.joinWorkspacePath(workspaceRoot, candidate);
			if (!(await this.storage.exists(candidateWorkspacePath).catch(() => false))) {
				return candidate;
			}
		}

		throw new BadRequestException('too many files with the same name in this session workspace');
	}

	private safeRelativePath(value: string): string {
		const normalized = value.trim().replace(/\\/g, '/');
		if (!normalized) {
			throw new BadRequestException('path is required');
		}
		if (this.isAbsoluteInputPath(normalized)) {
			throw new BadRequestException('path must be relative to the session workspace');
		}
		const segments = normalized.split('/').filter(Boolean);
		if (
			segments.length === 0 ||
			segments.some(segment => segment === '.' || segment === '..' || segment.includes('\0'))
		) {
			throw new BadRequestException('path must not contain traversal segments');
		}
		return path.posix.normalize(segments.join('/'));
	}

	private isAbsoluteInputPath(value: string): boolean {
		return (
			path.isAbsolute(value) ||
			/^[a-z][a-z0-9+.-]*:\/{1,2}/i.test(value) ||
			/^[a-zA-Z]:[\\/]/.test(value)
		);
	}

	private fileBuffer(buffer: Buffer | undefined): Buffer {
		if (!buffer) {
			throw new BadRequestException('file is required');
		}
		return buffer;
	}

	private async assertChunkAccess(
		metadata: ChunkedUploadMetadata,
		sessionId: string,
		userId?: string | null,
	): Promise<{ agentId?: string; userId?: string }> {
		if (metadata.sessionId !== sessionId) {
			throw new BadRequestException('uploadId does not belong to this session');
		}
		return this.sessionAccess.requireOwnedSession(sessionId, userId);
	}

	private async readChunkMetadata(uploadId: string): Promise<ChunkedUploadMetadata> {
		const safeUploadId = this.safeUploadId(uploadId);
		try {
			const content = await this.storage.readFile(await this.chunkMetadataPath(safeUploadId));
			return JSON.parse(content) as ChunkedUploadMetadata;
		} catch {
			throw new BadRequestException('upload session not found');
		}
	}

	private async writeChunkMetadata(metadata: ChunkedUploadMetadata): Promise<void> {
		await this.storage.writeFile(
			await this.chunkMetadataPath(metadata.uploadId),
			JSON.stringify(metadata, null, 2),
		);
	}

	private toProgress(metadata: ChunkedUploadMetadata): SessionWorkspaceChunkedUploadProgress {
		const uploadedBytes = (metadata.chunkAddressing ?? 'index') === 'offset'
			? this.contiguousUploadedBytes(metadata)
			: Object.values(metadata.receivedChunks).reduce((total, size) => total + size, 0);
		const totalBytes = metadata.size;
		return {
			uploadId: metadata.uploadId,
			status: metadata.status,
			path: metadata.relativePath,
			fileName: metadata.fileName,
			size: totalBytes,
			mimeType: metadata.mimeType,
			chunkSize: metadata.chunkSize,
			chunkCount: metadata.chunkCount,
			receivedChunks: Object.keys(metadata.receivedChunks).length,
			uploadedBytes,
			progress: totalBytes > 0 ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)) : 100,
			completed: metadata.status === 'completed',
			result: metadata.result,
		};
	}

	private resolveChunkAddressing(input: SessionWorkspaceUploadChunkedFileInput): SessionWorkspaceChunkAddressing {
		if (input.offset !== undefined || input.chunkIndex === undefined) {
			return 'offset';
		}
		return input.chunkCount === undefined && input.totalChunks === undefined ? 'offset' : 'index';
	}

	private resolveChunkOffset(metadata: ChunkedUploadMetadata, offset: number | undefined, chunkSize: number): number {
		const chunkOffset = offset === undefined
			? this.contiguousUploadedBytes(metadata)
			: this.nonNegativeInteger(offset, 'offset');
		if (chunkOffset > metadata.size || chunkOffset + chunkSize > metadata.size) {
			throw new BadRequestException('chunk exceeds declared file size');
		}
		return chunkOffset;
	}

	private resolveChunkIndex(metadata: ChunkedUploadMetadata, value: number | undefined): number {
		const chunkIndex = this.nonNegativeInteger(value, 'chunkIndex');
		if (metadata.chunkCount !== undefined && chunkIndex >= metadata.chunkCount) {
			throw new BadRequestException('chunkIndex is out of range');
		}
		return chunkIndex;
	}

	private isProgressReadyToComplete(progress: SessionWorkspaceChunkedUploadProgress): boolean {
		if (progress.chunkCount !== undefined) {
			return progress.receivedChunks === progress.chunkCount;
		}
		return progress.uploadedBytes === progress.size;
	}

	private completeOffsetChunkKeys(metadata: ChunkedUploadMetadata): string[] {
		const ranges = this.sortedChunkRanges(metadata);
		let expectedOffset = 0;
		const keys: string[] = [];
		for (const range of ranges) {
			if (range.start < expectedOffset) {
				throw new BadRequestException('uploaded chunks overlap');
			}
			if (range.start > expectedOffset) {
				throw new BadRequestException(`missing bytes from offset ${expectedOffset}`);
			}
			expectedOffset = range.end;
			keys.push(range.key);
		}
		if (expectedOffset !== metadata.size) {
			throw new BadRequestException(`missing bytes from offset ${expectedOffset}`);
		}
		return keys;
	}

	private completeIndexedChunkKeys(metadata: ChunkedUploadMetadata): string[] {
		const chunkCount = metadata.chunkCount;
		if (!chunkCount) {
			throw new BadRequestException('chunkCount is required before completing upload');
		}
		const missingChunks = Array.from({ length: chunkCount }, (_, index) => index).filter(
			index => metadata.receivedChunks[String(index)] === undefined,
		);
		if (missingChunks.length > 0) {
			throw new BadRequestException(`missing chunks: ${missingChunks.slice(0, 10).join(',')}`);
		}
		return Array.from({ length: chunkCount }, (_, index) => String(index));
	}

	private contiguousUploadedBytes(metadata: ChunkedUploadMetadata): number {
		let uploadedBytes = 0;
		for (const range of this.sortedChunkRanges(metadata)) {
			if (range.start !== uploadedBytes) {
				break;
			}
			uploadedBytes = range.end;
		}
		return Math.min(uploadedBytes, metadata.size);
	}

	private sortedChunkRanges(metadata: ChunkedUploadMetadata): Array<{ key: string; start: number; end: number }> {
		return Object.entries(metadata.receivedChunks)
			.map(([key, size]) => {
				const start = Number(key);
				if (!Number.isSafeInteger(start) || start < 0) {
					throw new BadRequestException('invalid uploaded chunk offset');
				}
				if (!Number.isSafeInteger(size) || size < 0) {
					throw new BadRequestException('invalid uploaded chunk size');
				}
				return { key, start, end: start + size };
			})
			.sort((left, right) => left.start - right.start);
	}

	private safeUploadId(value: string): string {
		const trimmed = value?.trim();
		if (!/^wup-[A-Za-z0-9_-]+-[A-Za-z0-9_-]+$/.test(trimmed)) {
			throw new BadRequestException('invalid uploadId');
		}
		return trimmed;
	}

	/**
	 * Storage-key prefix where in-flight chunk upload state (metadata + parts) is
	 * staged. This is a key inside the shared local WORKSPACE_STORAGE, so metadata
	 * and chunks are cleaned up consistently after the final file is written.
	 *
	 * SESSION_WORKSPACE_CHUNK_UPLOAD_DIR overrides the prefix (identical on every
	 * replica, so it stays shared); it must point at a location served by the same
	 * storage backend, not a node-local directory.
	 */
	private async chunkStagingRoot(): Promise<string> {
		const override = process.env.SESSION_WORKSPACE_CHUNK_UPLOAD_DIR;
		if (override) {
			return override;
		}
		const defaultRoot = await this.storage.getDefaultRoot();
		return this.joinWorkspacePath(defaultRoot, '.session-workspace-upload-chunks');
	}

	private async chunkDir(uploadId: string): Promise<string> {
		return this.joinWorkspacePath(await this.chunkStagingRoot(), this.safeUploadId(uploadId));
	}

	private async chunkMetadataPath(uploadId: string): Promise<string> {
		return this.joinWorkspacePath(await this.chunkDir(uploadId), 'metadata.json');
	}

	private async chunkFilePath(uploadId: string, chunkKey: string | number): Promise<string> {
		return this.joinWorkspacePath(await this.chunkDir(uploadId), `${chunkKey}.part`);
	}

	private nonNegativeInteger(value: number | undefined, field: string): number {
		if (value === undefined || !Number.isInteger(value) || value < 0) {
			throw new BadRequestException(`${field} must be a non-negative integer`);
		}
		return value;
	}

	private positiveInteger(value: number, field: string): number {
		if (!Number.isInteger(value) || value <= 0) {
			throw new BadRequestException(`${field} must be a positive integer`);
		}
		return value;
	}

	private missingInteger(field: string): never {
		throw new BadRequestException(`${field} must be an integer`);
	}

	private joinWorkspacePath(root: string, ...segments: string[]): string {
		if (this.isRemoteWorkspacePath(root)) {
			const normalizedRoot = root.replace(/[\\/]+$/g, '');
			const normalizedSegments = segments
				.map(segment => segment.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
				.filter(Boolean);
			return [normalizedRoot, ...normalizedSegments].join('/');
		}
		return path.join(root, ...segments);
	}

	private parentWorkspacePath(pathValue: string): string {
		const normalized = pathValue.replace(/\\/g, '/').replace(/\/+$/g, '');
		const schemeMatch = normalized.match(/^[a-z][a-z0-9+.-]*:\/{1,2}/i);
		const minIndex = schemeMatch ? schemeMatch[0].length : 1;
		const index = normalized.lastIndexOf('/');
		if (index < minIndex) {
			return normalized;
		}
		return normalized.slice(0, index);
	}

	private isRemoteWorkspacePath(value: string): boolean {
		const match = value.match(/^([a-z][a-z0-9+.-]*):\/{1,2}/i);
		const scheme = match?.[1]?.toLowerCase();
		return Boolean(scheme && scheme !== 'file');
	}

	private nextId(): string {
		return `wup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	}
}
