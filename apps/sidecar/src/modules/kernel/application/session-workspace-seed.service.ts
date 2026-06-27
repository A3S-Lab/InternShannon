import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
    type IWorkspaceStorage,
    WORKSPACE_STORAGE,
} from '../domain/services/workspace-storage.interface';

export interface SeedLocalDirectoryResult {
    sourceDir: string;
    workspaceRoot: string;
    filesCopied: number;
    bytesCopied: number;
    skippedEntries: number;
}

export interface SeedLocalDirectoryOptions {
    label?: string;
    concurrency?: number;
    excludeNames?: Iterable<string>;
}

interface LocalFileEntry {
    absolutePath: string;
    relativePath: string;
    size: number;
}

const DEFAULT_EXCLUDE_NAMES = new Set([
    '.git',
    '.sessions',
    '.memory',
    'node_modules',
    'dist',
    'build',
    '.next',
    '.cache',
    '__pycache__',
    '.venv',
    '.pytest_cache',
    '.mypy_cache',
    '.tsbuildinfo',
]);
const DEFAULT_COPY_CONCURRENCY = 8;

@Injectable()
export class SessionWorkspaceSeedService {
    private readonly logger = new Logger(SessionWorkspaceSeedService.name);

    constructor(
        @Inject(WORKSPACE_STORAGE)
        private readonly workspaceStorage: IWorkspaceStorage,
    ) {}

    async seedLocalDirectory(
        sourceDir: string,
        workspaceRoot: string,
        options: SeedLocalDirectoryOptions = {},
    ): Promise<SeedLocalDirectoryResult> {
        const sourceRoot = path.resolve(sourceDir);
        const targetRoot = workspaceRoot.trim();
        if (!targetRoot) {
            throw new Error('Cannot seed session workspace: workspaceRoot is empty');
        }

        const sourceStat = await fs.stat(sourceRoot);
        if (!sourceStat.isDirectory()) {
            throw new Error(`Cannot seed session workspace: source is not a directory (${sourceRoot})`);
        }

        if (this.isSameLocalDirectory(sourceRoot, targetRoot)) {
            return {
                sourceDir: sourceRoot,
                workspaceRoot: targetRoot,
                filesCopied: 0,
                bytesCopied: 0,
                skippedEntries: 0,
            };
        }

        const excluded = new Set([...DEFAULT_EXCLUDE_NAMES, ...(options.excludeNames ?? [])]);
        const entries = await this.collectFiles(sourceRoot, excluded);
        await this.workspaceStorage.mkdir(targetRoot);

        let filesCopied = 0;
        let bytesCopied = 0;
        await this.forEachConcurrent(entries.files, this.copyConcurrency(options.concurrency), async entry => {
            const data = await fs.readFile(entry.absolutePath);
            await this.workspaceStorage.writeBinaryFile(
                this.joinWorkspacePath(targetRoot, entry.relativePath),
                data,
            );
            filesCopied += 1;
            bytesCopied += entry.size;
        });

        this.logger.log(
            `Seeded ${filesCopied} files (${bytesCopied} bytes) into session workspace ${targetRoot}` +
                ` from ${sourceRoot}${options.label ? ` for ${options.label}` : ''}` +
                (entries.skippedEntries > 0 ? `; skipped ${entries.skippedEntries} entries` : ''),
        );

        return {
            sourceDir: sourceRoot,
            workspaceRoot: targetRoot,
            filesCopied,
            bytesCopied,
            skippedEntries: entries.skippedEntries,
        };
    }

    private async collectFiles(
        sourceRoot: string,
        excludedNames: Set<string>,
    ): Promise<{ files: LocalFileEntry[]; skippedEntries: number }> {
        const files: LocalFileEntry[] = [];
        let skippedEntries = 0;
        const stack = [sourceRoot];

        while (stack.length > 0) {
            const current = stack.pop()!;
            const entries = await fs.readdir(current, { withFileTypes: true });
            for (const entry of entries) {
                if (excludedNames.has(entry.name)) {
                    skippedEntries += 1;
                    continue;
                }
                const absolutePath = path.join(current, entry.name);
                if (entry.isSymbolicLink()) {
                    skippedEntries += 1;
                    continue;
                }
                if (entry.isDirectory()) {
                    stack.push(absolutePath);
                    continue;
                }
                if (!entry.isFile()) {
                    skippedEntries += 1;
                    continue;
                }
                const stat = await fs.stat(absolutePath);
                files.push({
                    absolutePath,
                    relativePath: this.relativeWorkspacePath(sourceRoot, absolutePath),
                    size: stat.size,
                });
            }
        }

        return { files, skippedEntries };
    }

    private relativeWorkspacePath(sourceRoot: string, absolutePath: string): string {
        return path.relative(sourceRoot, absolutePath).split(path.sep).join('/');
    }

    private isSameLocalDirectory(sourceRoot: string, workspaceRoot: string): boolean {
        if (this.isRemoteWorkspacePath(workspaceRoot)) return false;
        return path.resolve(workspaceRoot) === sourceRoot;
    }

    private isRemoteWorkspacePath(value: string): boolean {
        return /^[a-z][a-z0-9+.-]*:\/{1,2}/i.test(value);
    }

    private joinWorkspacePath(root: string, relativePath: string): string {
        const normalizedRelative = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
        if (this.isRemoteWorkspacePath(root)) {
            return `${root.replace(/\/+$/g, '')}/${normalizedRelative}`;
        }
        return path.join(root, normalizedRelative);
    }

    private copyConcurrency(value: number | undefined): number {
        if (!Number.isFinite(value) || !value || value <= 0) return DEFAULT_COPY_CONCURRENCY;
        return Math.max(1, Math.floor(value));
    }

    private async forEachConcurrent<T>(
        items: T[],
        concurrency: number,
        worker: (item: T) => Promise<void>,
    ): Promise<void> {
        let next = 0;
        const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
            while (next < items.length) {
                const index = next++;
                const item = items[index];
                if (item === undefined) break;
                await worker(item);
            }
        });
        await Promise.all(workers);
    }
}
