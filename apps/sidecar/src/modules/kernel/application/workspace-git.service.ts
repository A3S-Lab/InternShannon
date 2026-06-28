import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { BadRequestException, NotFoundException } from '@/shared/common/errors';
import {
    type IWorkspaceStorage,
    type WsDirEntry,
    WORKSPACE_STORAGE,
} from '../domain/services/workspace-storage.interface';

export type WorkspaceGitChangeStatus = 'added' | 'modified' | 'deleted';

export interface WorkspaceGitFileChange {
    path: string;
    status: WorkspaceGitChangeStatus;
    additions: number;
    deletions: number;
    binary?: boolean;
    oldSha?: string;
    newSha?: string;
    diff?: string;
}

export interface WorkspaceGitStatusFile {
    path: string;
    status: 'M' | 'D' | '??';
    staged: boolean;
}

export interface WorkspaceGitStatus {
    isGitRepo: boolean;
    branch: string;
    ahead: number;
    behind: number;
    staged: string[];
    modified: string[];
    untracked: string[];
    deleted: string[];
    conflicted: string[];
    files: WorkspaceGitStatusFile[];
}

export interface WorkspaceGitBranchItem {
    name: string;
    isRemote?: boolean;
    isProtected?: boolean;
    lastCommit?: string;
    lastCommitMessage?: string;
    lastCommitTime?: string;
}

export interface WorkspaceGitBranchList {
    current: string;
    branches: WorkspaceGitBranchItem[];
}

export interface WorkspaceGitCommitItem {
    commitId: string;
    shortId: string;
    message: string;
    author?: string;
    authorEmail?: string;
    timestamp?: string;
    filesChanged?: number;
    additions?: number;
    deletions?: number;
    parents?: string[];
}

export interface WorkspaceGitCommitDetail extends WorkspaceGitCommitItem {
    files?: WorkspaceGitFileChange[];
}

export interface WorkspaceGitCommitList {
    total: number;
    pageNum: number;
    pageSize: number;
    totalPages: number;
    items: WorkspaceGitCommitItem[];
}

export interface WorkspaceGitCommitOptions {
    message: string;
    branch?: string;
    author?: string;
    authorEmail?: string;
    allowEmpty?: boolean;
}

export interface WorkspaceGitCreateCommitResult extends WorkspaceGitCommitDetail {
    branch: string;
}

export interface WorkspaceGitCreateBranchOptions {
    name: string;
    from?: string;
}

export interface WorkspaceGitCreateBranchResult {
    name: string;
    from?: string;
    commitId?: string;
}

export interface WorkspaceGitCheckoutResult {
    branch: string;
    commitId?: string;
}

export interface WorkspaceGitDiffResult {
    diffs: WorkspaceGitFileChange[];
}

interface WorkspaceGitFileRecord {
    path: string;
    sha256: string;
    size: number;
    isBinary: boolean;
    modifiedAt?: string;
}

type WorkspaceGitTree = Record<string, WorkspaceGitFileRecord>;

interface WorkspaceGitState {
    version: 1;
    currentBranch: string;
    branches: Record<string, WorkspaceGitBranchRef>;
}

interface WorkspaceGitBranchRef {
    name: string;
    head?: string;
    createdAt: string;
    updatedAt: string;
}

interface WorkspaceGitCommitObject {
    version: 1;
    commitId: string;
    branch: string;
    message: string;
    author?: string;
    authorEmail?: string;
    timestamp: string;
    parents: string[];
    tree: WorkspaceGitTree;
    files: WorkspaceGitFileChange[];
    additions: number;
    deletions: number;
}

const DEFAULT_BRANCH = 'main';
const GIT_META_DIR = '.a3s/workspace-git';
const MAX_DIFF_BYTES = 512 * 1024;

@Injectable()
export class WorkspaceGitService {
    constructor(
        @Inject(WORKSPACE_STORAGE) private readonly storage: IWorkspaceStorage,
    ) {}

    async getStatus(workspaceRoot: string, branch?: string): Promise<WorkspaceGitStatus> {
        const state = await this.loadState(workspaceRoot);
        const branchName = this.resolveBranchName(state, branch);
        const branchRef = state.branches[branchName];
        const baseTree = branchRef?.head ? await this.readCommitTree(workspaceRoot, branchRef.head) : {};
        const currentTree = await this.snapshotWorkspace(workspaceRoot);
        const changes = await this.buildChanges(workspaceRoot, baseTree, currentTree, {
            includeDiff: false,
            includeStats: false,
        });

        const modified = changes.filter(item => item.status === 'modified').map(item => item.path);
        const untracked = changes.filter(item => item.status === 'added').map(item => item.path);
        const deleted = changes.filter(item => item.status === 'deleted').map(item => item.path);

        return {
            isGitRepo: true,
            branch: branchName,
            ahead: 0,
            behind: 0,
            staged: [],
            modified,
            untracked,
            deleted,
            conflicted: [],
            files: changes.map(change => ({
                path: change.path,
                status: change.status === 'added' ? '??' : change.status === 'modified' ? 'M' : 'D',
                staged: false,
            })),
        };
    }

    async listBranches(workspaceRoot: string): Promise<WorkspaceGitBranchList> {
        const state = await this.loadState(workspaceRoot);
        const branches = await Promise.all(
            Object.values(state.branches)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(async branch => this.toBranchItem(workspaceRoot, branch)),
        );
        return { current: state.currentBranch, branches };
    }

    async getCurrentBranch(workspaceRoot: string): Promise<WorkspaceGitCheckoutResult> {
        const state = await this.loadState(workspaceRoot);
        const current = state.branches[state.currentBranch];
        return { branch: state.currentBranch, commitId: current?.head };
    }

    async listCommits(
        workspaceRoot: string,
        options: { page?: number; pageSize?: number; branch?: string; path?: string } = {},
    ): Promise<WorkspaceGitCommitList> {
        const state = await this.loadState(workspaceRoot);
        const branchName = this.resolveBranchName(state, options.branch);
        const branch = state.branches[branchName];
        const normalizedPath = options.path ? this.normalizeRelativePath(options.path) : undefined;
        const commits = branch?.head
            ? await this.walkCommitHistory(workspaceRoot, branch.head, normalizedPath)
            : [];
        const pageNum = this.positiveInt(options.page, 1);
        const pageSize = Math.min(this.positiveInt(options.pageSize, 20), 100);
        const start = (pageNum - 1) * pageSize;
        const items = commits.slice(start, start + pageSize).map(commit => this.toCommitItem(commit));
        return {
            total: commits.length,
            pageNum,
            pageSize,
            totalPages: Math.ceil(commits.length / pageSize),
            items,
        };
    }

    async getCommitDetail(workspaceRoot: string, commitId: string): Promise<WorkspaceGitCommitDetail> {
        const commit = await this.readCommit(workspaceRoot, commitId);
        return this.toCommitDetail(commit);
    }

    async getCommitDiff(
        workspaceRoot: string,
        commitId: string,
        pathFilter?: string,
    ): Promise<WorkspaceGitDiffResult> {
        const commit = await this.readCommit(workspaceRoot, commitId);
        const parentTree = commit.parents[0]
            ? await this.readCommitTree(workspaceRoot, commit.parents[0])
            : {};
        const normalizedPath = pathFilter ? this.normalizeRelativePath(pathFilter) : undefined;
        const diffs = await this.buildChanges(workspaceRoot, parentTree, commit.tree, {
            includeDiff: true,
            includeStats: true,
            pathFilter: normalizedPath,
        });
        return { diffs };
    }

    async getDiff(workspaceRoot: string, pathFilter?: string): Promise<WorkspaceGitDiffResult> {
        const state = await this.loadState(workspaceRoot);
        const branch = state.branches[state.currentBranch];
        const baseTree = branch?.head ? await this.readCommitTree(workspaceRoot, branch.head) : {};
        const currentTree = await this.snapshotWorkspace(workspaceRoot);
        const normalizedPath = pathFilter ? this.normalizeRelativePath(pathFilter) : undefined;
        const diffs = await this.buildChanges(workspaceRoot, baseTree, currentTree, {
            includeDiff: true,
            includeStats: true,
            pathFilter: normalizedPath,
            newContent: file => this.readWorkingFile(workspaceRoot, file.path),
        });
        return { diffs };
    }

    async createCommit(
        workspaceRoot: string,
        options: WorkspaceGitCommitOptions,
    ): Promise<WorkspaceGitCreateCommitResult> {
        const message = options.message?.trim();
        if (!message) {
            throw new BadRequestException('提交说明不能为空');
        }

        const state = await this.loadState(workspaceRoot);
        const branchName = this.resolveBranchName(state, options.branch);
        const branch = state.branches[branchName];
        if (!branch) {
            throw new BadRequestException('分支不存在');
        }

        const baseTree = branch.head ? await this.readCommitTree(workspaceRoot, branch.head) : {};
        const currentTree = await this.snapshotWorkspace(workspaceRoot);
        const files = await this.buildChanges(workspaceRoot, baseTree, currentTree, {
            includeDiff: false,
            includeStats: true,
            newContent: file => this.readWorkingFile(workspaceRoot, file.path),
        });

        if (files.length === 0 && !options.allowEmpty) {
            throw new BadRequestException('当前工作区没有可提交的变更');
        }

        await this.persistCurrentBlobs(workspaceRoot, currentTree);

        const timestamp = new Date().toISOString();
        const parents = branch.head ? [branch.head] : [];
        const additions = files.reduce((sum, item) => sum + item.additions, 0);
        const deletions = files.reduce((sum, item) => sum + item.deletions, 0);
        const commitPayload = {
            version: 1 as const,
            branch: branchName,
            message,
            author: options.author,
            authorEmail: options.authorEmail,
            timestamp,
            parents,
            tree: this.sortTree(currentTree),
            files,
            additions,
            deletions,
        };
        const commitId = this.sha1Json(commitPayload);
        const commit: WorkspaceGitCommitObject = { ...commitPayload, commitId };

        await this.writeJson(this.commitPath(workspaceRoot, commitId), commit);
        const now = new Date().toISOString();
        state.currentBranch = branchName;
        state.branches[branchName] = {
            ...branch,
            head: commitId,
            updatedAt: now,
        };
        await this.saveState(workspaceRoot, state);

        return { ...this.toCommitDetail(commit), branch: branchName };
    }

    async createBranch(
        workspaceRoot: string,
        options: WorkspaceGitCreateBranchOptions,
    ): Promise<WorkspaceGitCreateBranchResult> {
        const name = this.normalizeBranchName(options.name);
        const state = await this.loadState(workspaceRoot);
        if (state.branches[name]) {
            throw new BadRequestException('分支已存在');
        }

        const from = options.from ? this.normalizeBranchName(options.from) : state.currentBranch;
        const source = state.branches[from];
        if (!source) {
            throw new BadRequestException('源分支不存在');
        }

        const now = new Date().toISOString();
        state.branches[name] = {
            name,
            head: source.head,
            createdAt: now,
            updatedAt: now,
        };
        await this.saveState(workspaceRoot, state);
        return { name, from, commitId: source.head };
    }

    async checkoutBranch(workspaceRoot: string, branchName: string): Promise<WorkspaceGitCheckoutResult> {
        const name = this.normalizeBranchName(branchName);
        const state = await this.loadState(workspaceRoot);
        const branch = state.branches[name];
        if (!branch) {
            throw new BadRequestException('分支不存在');
        }
        state.currentBranch = name;
        await this.saveState(workspaceRoot, state);
        return { branch: name, commitId: branch.head };
    }

    private async loadState(workspaceRoot: string): Promise<WorkspaceGitState> {
        const state = await this.readJson<WorkspaceGitState>(this.statePath(workspaceRoot));
        if (!state?.branches || !state.currentBranch) {
            return this.defaultState();
        }
        if (!state.branches[state.currentBranch]) {
            const now = new Date().toISOString();
            state.branches[state.currentBranch] = {
                name: state.currentBranch,
                createdAt: now,
                updatedAt: now,
            };
        }
        return state;
    }

    private defaultState(): WorkspaceGitState {
        const now = new Date().toISOString();
        return {
            version: 1,
            currentBranch: DEFAULT_BRANCH,
            branches: {
                [DEFAULT_BRANCH]: {
                    name: DEFAULT_BRANCH,
                    createdAt: now,
                    updatedAt: now,
                },
            },
        };
    }

    private async saveState(workspaceRoot: string, state: WorkspaceGitState): Promise<void> {
        await this.writeJson(this.statePath(workspaceRoot), state);
    }

    private async snapshotWorkspace(workspaceRoot: string): Promise<WorkspaceGitTree> {
        const tree: WorkspaceGitTree = {};
        await this.walkWorkspace(workspaceRoot, '', tree);
        return this.sortTree(tree);
    }

    private async walkWorkspace(
        workspaceRoot: string,
        relativeDir: string,
        tree: WorkspaceGitTree,
    ): Promise<void> {
        const absoluteDir = relativeDir ? this.joinStoragePath(workspaceRoot, relativeDir) : workspaceRoot;
        let entries: WsDirEntry[];
        try {
            entries = await this.storage.readDir(absoluteDir);
        } catch {
            return;
        }

        for (const entry of entries) {
            const relativePath = relativeDir
                ? path.posix.join(relativeDir, entry.name)
                : entry.name;
            if (this.isIgnoredPath(relativePath)) {
                continue;
            }
            if (entry.isDirectory) {
                await this.walkWorkspace(workspaceRoot, relativePath, tree);
                continue;
            }
            if (!entry.isFile) {
                continue;
            }

            const absolutePath = this.joinStoragePath(workspaceRoot, relativePath);
            const content = await this.storage.readBinaryFile(absolutePath);
            tree[relativePath] = {
                path: relativePath,
                sha256: this.sha256(content),
                size: entry.size ?? content.byteLength,
                isBinary: entry.isBinary ?? this.isBinaryContent(relativePath, content),
                modifiedAt: entry.modifiedAt,
            };
        }
    }

    private async buildChanges(
        workspaceRoot: string,
        oldTree: WorkspaceGitTree,
        newTree: WorkspaceGitTree,
        options: {
            includeDiff: boolean;
            includeStats: boolean;
            pathFilter?: string;
            newContent?: (file: WorkspaceGitFileRecord) => Promise<Buffer>;
        },
    ): Promise<WorkspaceGitFileChange[]> {
        const paths = Array.from(new Set([...Object.keys(oldTree), ...Object.keys(newTree)]))
            .filter(item => this.matchesPathFilter(item, options.pathFilter))
            .sort();
        const changes: WorkspaceGitFileChange[] = [];

        for (const filePath of paths) {
            const oldFile = oldTree[filePath];
            const newFile = newTree[filePath];
            if (oldFile && newFile && oldFile.sha256 === newFile.sha256) {
                continue;
            }

            const status: WorkspaceGitChangeStatus = oldFile && newFile
                ? 'modified'
                : oldFile
                    ? 'deleted'
                    : 'added';
            const binary = Boolean(oldFile?.isBinary || newFile?.isBinary);
            const change: WorkspaceGitFileChange = {
                path: filePath,
                status,
                additions: 0,
                deletions: 0,
                binary,
                oldSha: oldFile?.sha256,
                newSha: newFile?.sha256,
            };

            if (options.includeStats || options.includeDiff) {
                const oldContent = oldFile
                    ? await this.readBlobOrEmpty(workspaceRoot, oldFile.sha256)
                    : Buffer.alloc(0);
                const newContent = newFile
                    ? await (options.newContent?.(newFile) ?? this.readBlobOrEmpty(workspaceRoot, newFile.sha256))
                    : Buffer.alloc(0);
                const stats = this.lineStats(oldContent, newContent, binary);
                change.additions = stats.additions;
                change.deletions = stats.deletions;
                if (options.includeDiff) {
                    change.diff = this.unifiedDiff(filePath, status, oldContent, newContent, binary);
                }
            }

            changes.push(change);
        }

        return changes;
    }

    private async persistCurrentBlobs(workspaceRoot: string, tree: WorkspaceGitTree): Promise<void> {
        for (const file of Object.values(tree)) {
            const blobPath = this.blobPath(workspaceRoot, file.sha256);
            if (await this.storage.exists(blobPath)) {
                continue;
            }
            const content = await this.readWorkingFile(workspaceRoot, file.path);
            await this.storage.writeBinaryFile(blobPath, content);
        }
    }

    private async walkCommitHistory(
        workspaceRoot: string,
        head: string,
        pathFilter?: string,
    ): Promise<WorkspaceGitCommitObject[]> {
        const commits: WorkspaceGitCommitObject[] = [];
        const seen = new Set<string>();
        let cursor: string | undefined = head;
        while (cursor && !seen.has(cursor)) {
            seen.add(cursor);
            const commit = await this.readCommit(workspaceRoot, cursor);
            if (!pathFilter || commit.files.some(file => this.matchesPathFilter(file.path, pathFilter))) {
                commits.push(commit);
            }
            cursor = commit.parents[0];
        }
        return commits;
    }

    private async readCommitTree(workspaceRoot: string, commitId: string): Promise<WorkspaceGitTree> {
        return (await this.readCommit(workspaceRoot, commitId)).tree ?? {};
    }

    private async readCommit(workspaceRoot: string, commitId: string): Promise<WorkspaceGitCommitObject> {
        const normalized = commitId.trim();
        if (!/^[a-f0-9]{7,40}$/i.test(normalized)) {
            throw new BadRequestException('提交 ID 格式无效');
        }
        const commit = await this.readJson<WorkspaceGitCommitObject>(this.commitPath(workspaceRoot, normalized));
        if (commit) return commit;

        if (normalized.length < 40) {
            const matches = await this.findCommitByPrefix(workspaceRoot, normalized);
            if (matches.length === 1) {
                return matches[0];
            }
            if (matches.length > 1) {
                throw new BadRequestException('提交 ID 前缀不唯一');
            }
        }

        throw new NotFoundException('提交不存在');
    }

    private async findCommitByPrefix(workspaceRoot: string, prefix: string): Promise<WorkspaceGitCommitObject[]> {
        const commitsDir = this.metaPath(workspaceRoot, 'commits');
        let entries: WsDirEntry[];
        try {
            entries = await this.storage.readDir(commitsDir);
        } catch {
            return [];
        }
        const matches = entries
            .filter(entry => entry.isFile && entry.name.endsWith('.json') && entry.name.startsWith(prefix))
            .map(entry => entry.name.replace(/\.json$/i, ''));
        const commits: WorkspaceGitCommitObject[] = [];
        for (const commitId of matches) {
            const commit = await this.readJson<WorkspaceGitCommitObject>(this.commitPath(workspaceRoot, commitId));
            if (commit) commits.push(commit);
        }
        return commits;
    }

    private async toBranchItem(
        workspaceRoot: string,
        branch: WorkspaceGitBranchRef,
    ): Promise<WorkspaceGitBranchItem> {
        const item: WorkspaceGitBranchItem = {
            name: branch.name,
            isRemote: false,
            isProtected: branch.name === DEFAULT_BRANCH,
            lastCommit: branch.head,
        };
        if (branch.head) {
            const commit = await this.readJson<WorkspaceGitCommitObject>(this.commitPath(workspaceRoot, branch.head));
            item.lastCommitMessage = commit?.message;
            item.lastCommitTime = commit?.timestamp;
        }
        return item;
    }

    private toCommitItem(commit: WorkspaceGitCommitObject): WorkspaceGitCommitItem {
        return {
            commitId: commit.commitId,
            shortId: commit.commitId.slice(0, 7),
            message: commit.message,
            author: commit.author,
            authorEmail: commit.authorEmail,
            timestamp: commit.timestamp,
            filesChanged: commit.files.length,
            additions: commit.additions,
            deletions: commit.deletions,
            parents: commit.parents,
        };
    }

    private toCommitDetail(commit: WorkspaceGitCommitObject): WorkspaceGitCommitDetail {
        return {
            ...this.toCommitItem(commit),
            files: commit.files,
        };
    }

    private resolveBranchName(state: WorkspaceGitState, branch?: string): string {
        return branch ? this.normalizeBranchName(branch) : state.currentBranch || DEFAULT_BRANCH;
    }

    private normalizeBranchName(value: string): string {
        const name = value.trim();
        if (
            !name ||
            name === 'HEAD' ||
            name.startsWith('/') ||
            name.endsWith('/') ||
            name.includes('//') ||
            name.includes('..') ||
            /[\s~^:?*[\]\\]/.test(name)
        ) {
            throw new BadRequestException('分支名称无效');
        }
        return name;
    }

    private normalizeRelativePath(value: string): string {
        const normalized = value.trim().replace(/\\/g, '/');
        if (!normalized) return '';
        if (
            normalized.startsWith('/') ||
            /^[a-z][a-z0-9+.-]*:\/{1,2}/i.test(normalized) ||
            normalized.includes('\0')
        ) {
            throw new BadRequestException('路径必须是工作区内的相对路径');
        }
        const safe = path.posix.normalize(normalized).replace(/^\.\/+/, '');
        if (safe === '..' || safe.startsWith('../')) {
            throw new BadRequestException('路径不能包含目录穿越');
        }
        return safe === '.' ? '' : safe;
    }

    private matchesPathFilter(filePath: string, pathFilter?: string): boolean {
        if (!pathFilter) return true;
        return filePath === pathFilter || filePath.startsWith(`${pathFilter.replace(/\/+$/g, '')}/`);
    }

    private isIgnoredPath(relativePath: string): boolean {
        const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
        const segments = normalized.split('/').filter(Boolean);
        if (segments.length === 0) return true;
        if (segments[0] === '.a3s' && segments[1] === 'workspace-git') return true;
        if (segments.includes('.git') || segments.includes('node_modules')) return true;
        const fileName = segments[segments.length - 1];
        return fileName === '.keep' || fileName === '.DS_Store' || fileName === '.internshannon-trash';
    }

    private lineStats(oldContent: Buffer, newContent: Buffer, binary: boolean): { additions: number; deletions: number } {
        if (binary) return { additions: 0, deletions: 0 };
        return {
            additions: this.textLines(newContent).length,
            deletions: this.textLines(oldContent).length,
        };
    }

    private unifiedDiff(
        filePath: string,
        status: WorkspaceGitChangeStatus,
        oldContent: Buffer,
        newContent: Buffer,
        binary: boolean,
    ): string {
        const header = [
            `diff --git a/${filePath} b/${filePath}`,
            status === 'added'
                ? 'new file mode 100644'
                : status === 'deleted'
                    ? 'deleted file mode 100644'
                    : undefined,
            `--- ${status === 'added' ? '/dev/null' : `a/${filePath}`}`,
            `+++ ${status === 'deleted' ? '/dev/null' : `b/${filePath}`}`,
        ].filter(Boolean) as string[];

        if (binary || oldContent.byteLength > MAX_DIFF_BYTES || newContent.byteLength > MAX_DIFF_BYTES) {
            return [...header, 'Binary files differ'].join('\n');
        }

        const oldLines = this.textLines(oldContent);
        const newLines = this.textLines(newContent);
        const oldRange = status === 'added' ? '0,0' : `1,${oldLines.length}`;
        const newRange = status === 'deleted' ? '0,0' : `1,${newLines.length}`;
        const body = [
            `@@ -${oldRange} +${newRange} @@`,
            ...oldLines.map(line => `-${line}`),
            ...newLines.map(line => `+${line}`),
        ];
        return [...header, ...body].join('\n');
    }

    private textLines(content: Buffer): string[] {
        if (content.byteLength === 0) return [];
        const normalized = content.toString('utf8').replace(/\r\n/g, '\n');
        const lines = normalized.split('\n');
        if (lines[lines.length - 1] === '') {
            lines.pop();
        }
        return lines;
    }

    private isBinaryContent(filePath: string, content: Buffer): boolean {
        if (content.includes(0)) return true;
        const ext = path.posix.extname(filePath).toLowerCase();
        if (!ext) return false;
        return !new Set([
            '.acl',
            '.bash',
            '.c',
            '.conf',
            '.cpp',
            '.css',
            '.csv',
            '.env',
            '.go',
            '.graphql',
            '.h',
            '.hpp',
            '.html',
            '.ini',
            '.java',
            '.js',
            '.json',
            '.jsx',
            '.lock',
            '.log',
            '.md',
            '.mjs',
            '.py',
            '.rs',
            '.sh',
            '.sql',
            '.toml',
            '.ts',
            '.tsx',
            '.txt',
            '.xml',
            '.yaml',
            '.yml',
            '.zsh',
        ]).has(ext);
    }

    private async readWorkingFile(workspaceRoot: string, filePath: string): Promise<Buffer> {
        return this.storage.readBinaryFile(this.joinStoragePath(workspaceRoot, filePath));
    }

    private async readBlobOrEmpty(workspaceRoot: string, sha: string): Promise<Buffer> {
        try {
            return await this.storage.readBinaryFile(this.blobPath(workspaceRoot, sha));
        } catch {
            return Buffer.alloc(0);
        }
    }

    private async readJson<T>(filePath: string): Promise<T | undefined> {
        if (!(await this.storage.exists(filePath))) {
            return undefined;
        }
        try {
            return JSON.parse(await this.storage.readFile(filePath)) as T;
        } catch {
            return undefined;
        }
    }

    private async writeJson(filePath: string, value: unknown): Promise<void> {
        await this.storage.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
    }

    private statePath(workspaceRoot: string): string {
        return this.metaPath(workspaceRoot, 'state.json');
    }

    private commitPath(workspaceRoot: string, commitId: string): string {
        return this.metaPath(workspaceRoot, 'commits', `${commitId}.json`);
    }

    private blobPath(workspaceRoot: string, sha: string): string {
        return this.metaPath(workspaceRoot, 'blobs', sha.slice(0, 2), sha);
    }

    private metaPath(workspaceRoot: string, ...segments: string[]): string {
        return this.joinStoragePath(workspaceRoot, GIT_META_DIR, ...segments);
    }

    private joinStoragePath(root: string, ...segments: string[]): string {
        const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/g, '');
        const normalizedSegments = segments
            .map(segment => segment.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
            .filter(Boolean);
        if (/^[a-z][a-z0-9+.-]*:\/{1,2}/i.test(normalizedRoot)) {
            return [normalizedRoot, ...normalizedSegments].join('/');
        }
        return path.join(root, ...normalizedSegments);
    }

    private sortTree(tree: WorkspaceGitTree): WorkspaceGitTree {
        return Object.fromEntries(
            Object.entries(tree).sort(([a], [b]) => a.localeCompare(b)),
        );
    }

    private sha256(content: Buffer): string {
        return createHash('sha256').update(content).digest('hex');
    }

    private sha1Json(value: unknown): string {
        return createHash('sha1').update(JSON.stringify(value)).digest('hex');
    }

    private positiveInt(value: number | undefined, fallback: number): number {
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
    }
}
