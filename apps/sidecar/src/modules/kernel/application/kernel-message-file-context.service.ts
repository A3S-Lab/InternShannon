import { Inject, Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import { type IWorkspaceStorage, WORKSPACE_STORAGE } from '../domain/services/workspace-storage.interface';

interface FileContextResult {
    content: string;
    fileCount: number;
    images: { mediaType: string; data: string }[];
}

@Injectable()
export class KernelMessageFileContextService {
    private readonly logger = new Logger(KernelMessageFileContextService.name);
    private static readonly MAX_CONTEXT_FILES = 5;
    private static readonly MAX_CONTEXT_BYTES = 512 * 1024;
    private static readonly MAX_VISION_IMAGES = 5;
    private static readonly MAX_VISION_IMAGE_BYTES = 20 * 1024 * 1024;

    private readonly visionImageMimeTypes = new Map([
        ['.gif', 'image/gif'],
        ['.jpeg', 'image/jpeg'],
        ['.jpg', 'image/jpeg'],
        ['.png', 'image/png'],
        ['.webp', 'image/webp'],
    ]);

    constructor(
        @Inject(WORKSPACE_STORAGE)
        private readonly storage: IWorkspaceStorage,
    ) {}

    async appendMentionedFileContext(input: { content: string; workspaceRoot?: string | null }): Promise<FileContextResult> {
        const content = input.content;
        const workspaceRoot = input.workspaceRoot?.trim();
        if (!content.includes('@/') || !workspaceRoot) {
            return { content, fileCount: 0, images: [] };
        }

        const root = path.resolve(workspaceRoot);
        const paths = await this.resolveMentionedFiles(content, root);
        if (paths.length === 0) {
            return { content, fileCount: 0, images: [] };
        }

        const sections: string[] = [];
        const images: { mediaType: string; data: string }[] = [];
        let usedBytes = 0;
        for (const filePath of paths.slice(0, KernelMessageFileContextService.MAX_CONTEXT_FILES)) {
            try {
                const fileContent = await this.storage.readFile(filePath);
                const visionAttachment = await this.readVisionImageAttachment(filePath);
                if (visionAttachment && images.length < KernelMessageFileContextService.MAX_VISION_IMAGES) {
                    images.push(visionAttachment);
                }
                const section = [
                    `### ${filePath}`,
                    visionAttachment
                        ? 'Vision attachment: included for multimodal analysis by vision-capable models.'
                        : undefined,
                    fileContent,
                ].filter((line): line is string => line !== undefined).join('\n');
                const remaining = KernelMessageFileContextService.MAX_CONTEXT_BYTES - usedBytes;
                if (remaining <= 0) break;
                const bounded = this.takeUtf8(section, remaining);
                usedBytes += Buffer.byteLength(bounded, 'utf8');
                sections.push(bounded);
                if (bounded.length < section.length) break;
            } catch (error) {
                this.logger.warn(
                    `Failed to append file context for ${filePath}: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }

        if (sections.length === 0) {
            return { content, fileCount: 0, images };
        }

        const suffix = [
            '',
            '',
            'The user mentioned the following workspace file(s). Their readable content or file metadata is included below so you can answer without re-reading binary files as UTF-8 text. Image files may also be attached to the multimodal request for vision-capable models.',
            '',
            sections.join('\n\n'),
        ].join('\n');
        const truncatedNotice =
            usedBytes >= KernelMessageFileContextService.MAX_CONTEXT_BYTES
                ? '\n\n[File context truncated after 524288 bytes.]'
                : '';
        return {
            content: `${content}${suffix}${truncatedNotice}`,
            fileCount: sections.length,
            images,
        };
    }

    private async readVisionImageAttachment(filePath: string): Promise<{ mediaType: string; data: string } | null> {
        const mediaType = this.visionImageMimeTypes.get(path.extname(filePath).toLowerCase());
        if (!mediaType) return null;

        const stat = await this.storage.stat(filePath).catch(() => null);
        if (!stat?.isFile || !stat.size || stat.size > KernelMessageFileContextService.MAX_VISION_IMAGE_BYTES) {
            return null;
        }

        const data = await this.storage.readBinaryFile(filePath);
        return {
            mediaType,
            data: data.toString('base64'),
        };
    }

    private async resolveMentionedFiles(content: string, workspaceRoot: string): Promise<string[]> {
        const paths: string[] = [];
        const seen = new Set<string>();
        const marker = '@/';
        let index = content.indexOf(marker);

        while (index >= 0) {
            const candidate = await this.resolveMentionAt(content, index + 1, workspaceRoot);
            if (candidate && !seen.has(candidate)) {
                seen.add(candidate);
                paths.push(candidate);
            }
            index = content.indexOf(marker, index + marker.length);
        }

        return paths;
    }

    private async resolveMentionAt(content: string, pathStart: number, workspaceRoot: string): Promise<string | null> {
        const rawTail = this.mentionTail(content.slice(pathStart));
        let candidate = this.cleanMentionCandidate(rawTail);
        while (candidate) {
            if (this.isInsideWorkspace(candidate, workspaceRoot) && (await this.storage.exists(candidate).catch(() => false))) {
                const stat = await this.storage.stat(candidate).catch(() => null);
                return stat?.isFile ? path.resolve(candidate) : null;
            }

            const trimmed = this.trimOneTrailingToken(candidate);
            if (trimmed === candidate) break;
            candidate = trimmed;
        }
        return null;
    }

    private mentionTail(value: string): string {
        const nextMention = value.search(/\s@\//);
        const newline = value.search(/[\r\n]/);
        const stops = [nextMention, newline].filter(stop => stop >= 0);
        const end = stops.length > 0 ? Math.min(...stops) : value.length;
        return value.slice(0, end);
    }

    private cleanMentionCandidate(value: string): string {
        return value.trim().replace(/[，。；;,.!?！？、)）\]}]+$/g, '').trim();
    }

    private trimOneTrailingToken(value: string): string {
        return this.cleanMentionCandidate(value.replace(/\s+\S+$/u, '').trim());
    }

    private isInsideWorkspace(candidate: string, workspaceRoot: string): boolean {
        if (!path.isAbsolute(candidate)) return false;
        const resolved = path.resolve(candidate);
        const relative = path.relative(workspaceRoot, resolved);
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    }

    private takeUtf8(value: string, maxBytes: number): string {
        if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
        let output = '';
        let used = 0;
        for (const char of value) {
            const size = Buffer.byteLength(char, 'utf8');
            if (used + size > maxBytes) break;
            used += size;
            output += char;
        }
        return output;
    }
}
