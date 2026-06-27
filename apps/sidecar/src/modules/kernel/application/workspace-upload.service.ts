import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@/shared/common/errors';
import {
	IWorkspaceStorage,
	WorkspaceUpload,
	WORKSPACE_STORAGE,
} from '../domain/services/workspace-storage.interface';

export interface CreateWorkspaceUploadInput {
	workspaceRoot?: string;
	fileName: string;
	relativePath?: string;
	mimeType?: string;
	encoding?: 'base64' | 'utf8' | 'bytes';
	dataBase64?: string;
	content?: string;
	data?: number[];
	metadata?: Record<string, unknown>;
}

export interface ListWorkspaceUploadsInput {
	workspaceRoot?: string;
}

const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

@Injectable()
export class WorkspaceUploadService {
	constructor(
		@Inject(WORKSPACE_STORAGE)
		private readonly storage: IWorkspaceStorage,
	) {}

	async list(input: ListWorkspaceUploadsInput, userId: string): Promise<WorkspaceUpload[]> {
		const root = await this.resolveWorkspaceRoot(input.workspaceRoot);
		const base = this.uploadBase(root, userId);
		const entries = await this.storage.readDir(base);
		const uploads: WorkspaceUpload[] = [];
		for (const entry of entries) {
			if (!entry.isDirectory) {
				continue;
			}
			try {
				uploads.push(await this.readMetadata(root, userId, entry.name));
			} catch {
				// Ignore incomplete upload directories so a bad upload does not break listing.
			}
		}
		return uploads.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	async create(input: CreateWorkspaceUploadInput, userId: string): Promise<WorkspaceUpload> {
		const root = await this.resolveWorkspaceRoot(input.workspaceRoot);
		const fileName = this.safeFileName(input.fileName);
		const relativePath = this.safeRelativePath(input.relativePath);
		const buffer = this.inputBuffer(input);
		this.assertUploadSize(buffer);

		const now = new Date().toISOString();
		const uploadId = this.nextId();
		const uploadDir = this.uploadDir(root, userId, uploadId);
		const contentPath = this.join(uploadDir, relativePath, fileName);
		const metadata: WorkspaceUpload = {
			uploadId,
			ownerId: userId,
			fileName,
			relativePath,
			path: contentPath,
			workspaceRoot: root,
			mimeType: input.mimeType?.trim() || undefined,
			size: buffer.length,
			sha256: createHash('sha256').update(buffer).digest('hex'),
			metadata: input.metadata ?? {},
			createdAt: now,
			updatedAt: now,
		};

		await this.storage.mkdir(uploadDir);
		await this.storage.writeBinaryFile(contentPath, buffer);
		await this.writeMetadata(root, userId, metadata);
		return metadata;
	}

	async get(uploadId: string, workspaceRoot: string | undefined, userId: string): Promise<WorkspaceUpload> {
		const root = await this.resolveWorkspaceRoot(workspaceRoot);
		return this.readMetadata(root, userId, uploadId);
	}

	async read(uploadId: string, workspaceRoot: string | undefined, userId: string): Promise<{ metadata: WorkspaceUpload; data: Buffer }> {
		const metadata = await this.get(uploadId, workspaceRoot, userId);
		return {
			metadata,
			data: await this.storage.readBinaryFile(metadata.path),
		};
	}

	async delete(uploadId: string, workspaceRoot: string | undefined, userId: string): Promise<void> {
		const root = await this.resolveWorkspaceRoot(workspaceRoot);
		await this.get(uploadId, root, userId);
		await this.storage.remove(this.uploadDir(root, userId, uploadId));
	}

	private async readMetadata(root: string, userId: string, uploadId: string): Promise<WorkspaceUpload> {
		const content = await this.storage.readFile(this.metadataPath(root, userId, uploadId)).catch(() => {
			throw new NotFoundException('Workspace upload not found');
		});
		const parsed = this.toRecord(this.parseJson(content));
		if (!parsed) {
			throw new NotFoundException('Workspace upload not found');
		}
		try {
			return this.normalizeUploadMetadata(root, userId, uploadId, parsed);
		} catch {
			throw new NotFoundException('Workspace upload not found');
		}
	}

	private async writeMetadata(root: string, userId: string, upload: WorkspaceUpload): Promise<void> {
		await this.storage.writeFile(this.metadataPath(root, userId, upload.uploadId), JSON.stringify(upload, null, 2));
	}

	private metadataPath(root: string, userId: string, uploadId: string): string {
		return this.join(this.uploadDir(root, userId, uploadId), 'metadata.json');
	}

	private uploadBase(root: string, userId: string): string {
		return this.join(root, 'uploads', this.safePathSegment(userId));
	}

	private uploadDir(root: string, userId: string, uploadId: string): string {
		return this.join(this.uploadBase(root, userId), this.safePathSegment(uploadId));
	}

	private normalizeUploadMetadata(
		root: string,
		userId: string,
		uploadId: string,
		metadata: Record<string, unknown>,
	): WorkspaceUpload {
		const fileName = this.safeFileName(this.stringValue(metadata.fileName));
		const relativePath = this.safeRelativePath(this.optionalStringValue(metadata.relativePath));
		const path = this.join(this.uploadDir(root, userId, uploadId), relativePath, fileName);
		return {
			uploadId,
			ownerId: userId,
			fileName,
			relativePath,
			path,
			workspaceRoot: root,
			mimeType: this.optionalStringValue(metadata.mimeType),
			size: this.numberValue(metadata.size),
			sha256: this.stringValue(metadata.sha256),
			metadata: this.toRecord(metadata.metadata) ?? {},
			createdAt: this.stringValue(metadata.createdAt),
			updatedAt: this.stringValue(metadata.updatedAt),
		};
	}

	private async resolveWorkspaceRoot(workspaceRoot?: string): Promise<string> {
		const root = workspaceRoot?.trim() || await this.storage.getDefaultRoot();
		if (!root) {
			throw new BadRequestException('Workspace root is required');
		}
		const normalized = root.replace(/\\/g, '/').replace(/\/+$/g, '');
		this.assertNoPathTraversal(normalized);
		return normalized;
	}

	private inputBuffer(input: CreateWorkspaceUploadInput): Buffer {
		if (input.dataBase64 !== undefined) {
			return Buffer.from(input.dataBase64, 'base64');
		}
		if (input.content !== undefined) {
			return Buffer.from(input.content, input.encoding === 'base64' ? 'base64' : 'utf8');
		}
		if (input.data !== undefined) {
			return Buffer.from(input.data);
		}
		throw new BadRequestException('Workspace upload requires dataBase64, content, or data');
	}

	private assertUploadSize(buffer: Buffer): void {
		const maxBytes = this.maxUploadBytes();
		if (buffer.length === 0) {
			throw new BadRequestException('Workspace upload cannot be empty');
		}
		if (buffer.length > maxBytes) {
			throw new BadRequestException(`Workspace upload cannot exceed ${maxBytes} bytes`);
		}
	}

	private maxUploadBytes(): number {
		const parsed = Number(process.env.WORKSPACE_UPLOAD_MAX_BYTES);
		return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_UPLOAD_BYTES;
	}

	private safeFileName(value: string): string {
		const fileName = value.trim().replace(/\\/g, '/').split('/').pop()?.trim();
		if (!fileName || fileName === '.' || fileName === '..') {
			throw new BadRequestException('Workspace upload fileName is required');
		}
		return fileName;
	}

	private safeRelativePath(value: string | undefined): string | undefined {
		if (!value?.trim()) {
			return undefined;
		}
		const segments = value
			.replace(/\\/g, '/')
			.split('/')
			.map(segment => segment.trim())
			.filter(Boolean)
			.filter(segment => segment !== '.' && segment !== '..')
			.map(segment => this.safePathSegment(segment));
		return segments.length ? segments.join('/') : undefined;
	}

	private safePathSegment(value: string): string {
		const segment = value.trim().replace(/[<>:"|?*\/\\\x00-\x1F]/g, '-');
		if (!segment || segment === '.' || segment === '..') {
			throw new BadRequestException('Invalid workspace upload path segment');
		}
		return segment;
	}

	private assertNoPathTraversal(pathValue: string): void {
		const segments = pathValue.split('/').filter(Boolean);
		if (segments.some(segment => segment === '.' || segment === '..')) {
			throw new BadRequestException('Workspace root cannot contain traversal segments');
		}
	}

	private stringValue(value: unknown): string {
		return typeof value === 'string' ? value : '';
	}

	private optionalStringValue(value: unknown): string | undefined {
		if (typeof value !== 'string') {
			return undefined;
		}
		const trimmed = value.trim();
		return trimmed || undefined;
	}

	private numberValue(value: unknown): number {
		const parsed = Number(value);
		return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
	}

	private join(...parts: Array<string | undefined>): string {
		return parts
			.filter((part): part is string => Boolean(part && part.trim()))
			.map((part, index) => index === 0 ? part.replace(/\/+$/g, '') : part.replace(/^\/+|\/+$/g, ''))
			.join('/');
	}

	private toRecord(value: unknown): Record<string, unknown> | undefined {
		return value && typeof value === 'object' && !Array.isArray(value)
			? value as Record<string, unknown>
			: undefined;
	}

	private parseJson(value: string): unknown {
		try {
			return JSON.parse(value);
		} catch {
			return undefined;
		}
	}

	private nextId(): string {
		return `wup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	}
}
