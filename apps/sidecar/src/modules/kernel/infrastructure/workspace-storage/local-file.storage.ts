import { Injectable } from '@nestjs/common';
import { existsSync, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    IWorkspaceStorage,
    ReplaceResult,
    SearchMatch,
    SearchResult,
    WORKSPACE_STORAGE,
    WorkspaceReadiness,
    WsDirEntry,
} from '../../domain/services/workspace-storage.interface';

@Injectable()
export class LocalFileStorage implements IWorkspaceStorage {
    readonly storageKind = 'local' as const;

    private readonly textExtensions = new Set([
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
    ]);

    private fileExtension(name: string): string {
        return path.extname(name).toLowerCase();
    }

    private isBinaryFileName(name: string): boolean {
        const ext = this.fileExtension(name);
        return Boolean(ext) && !this.textExtensions.has(ext);
    }

    private optionEnabled(value: unknown): boolean {
        return value === true || value === 'true';
    }

    private escapeRegex(value: string): string {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private createSearchPattern(
        query: string,
        options?: {
            caseSensitive?: boolean;
            useRegex?: boolean;
            matchWholeWord?: boolean;
        },
    ): { pattern: RegExp; useRegex: boolean } {
        const caseSensitive = this.optionEnabled(options?.caseSensitive);
        const useRegex = this.optionEnabled(options?.useRegex);
        const matchWholeWord = this.optionEnabled(options?.matchWholeWord);
        const source = useRegex ? query : this.escapeRegex(query);
        const pattern = matchWholeWord ? `\\b(?:${source})\\b` : source;
        return {
            pattern: new RegExp(pattern, caseSensitive ? 'g' : 'gi'),
            useRegex,
        };
    }

    private parseSearchPatternList(pattern?: string): string[] {
        return (pattern ?? '')
            .split(',')
            .map(item =>
                item
                    .trim()
                    .replace(/\\/g, '/')
                    .replace(/^\/+|\/+$/g, ''),
            )
            .filter(Boolean);
    }

    private globToRegExp(pattern: string): RegExp {
        let source = '';
        for (let index = 0; index < pattern.length; index++) {
            const char = pattern[index];
            if (char === '*' && pattern[index + 1] === '*') {
                source += '.*';
                index++;
                continue;
            }
            if (char === '*') {
                source += '[^/]*';
                continue;
            }
            if (char === '?') {
                source += '[^/]';
                continue;
            }
            source += this.escapeRegex(char);
        }
        return new RegExp(`^${source}$`);
    }

    private matchesSearchPattern(relativePath: string, pattern: string): boolean {
        const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
        const normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        if (!normalizedPath || !normalizedPattern) {
            return false;
        }

        if (normalizedPattern.endsWith('/**')) {
            const directoryPattern = normalizedPattern.slice(0, -3).replace(/\/+$/g, '');
            if (normalizedPath === directoryPattern || normalizedPath.startsWith(`${directoryPattern}/`)) {
                return true;
            }
        }

        const hasGlob = /[*?]/.test(normalizedPattern);
        const hasSlash = normalizedPattern.includes('/');
        if (!hasGlob && !hasSlash) {
            const segments = normalizedPath.split('/');
            return segments.includes(normalizedPattern);
        }

        if (!hasSlash) {
            return this.globToRegExp(normalizedPattern).test(path.posix.basename(normalizedPath));
        }

        return this.globToRegExp(normalizedPattern).test(normalizedPath);
    }

    private matchesAnySearchPattern(relativePath: string, patterns: string[]): boolean {
        return patterns.some(pattern => this.matchesSearchPattern(relativePath, pattern));
    }

    private shouldSearchFile(relativePath: string, includePatterns: string[], excludePatterns: string[]): boolean {
        if (excludePatterns.length > 0 && this.matchesAnySearchPattern(relativePath, excludePatterns)) {
            return false;
        }
        return includePatterns.length === 0 || this.matchesAnySearchPattern(relativePath, includePatterns);
    }

    private platformName(): string {
        return process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
    }

    private isDesktopMode(): boolean {
        return (process.env.APP_MODE || '').trim().toLowerCase() === 'desktop';
    }

    private resolveDefaultRoot(): string {
        const appDataDir = this.isDesktopMode() ? '.internshannon' : '.a3s';
        return path.join(os.homedir(), appDataDir, 'workspace');
    }

    private normalizeUserPath(inputPath: string): string {
        const trimmed = inputPath.trim();
        if (trimmed === '~' || trimmed.startsWith('~/')) {
            const home = os.homedir();
            return trimmed === '~' ? home : path.join(home, trimmed.slice(2));
        }
        const isAbsolute = path.isAbsolute(trimmed);
        return isAbsolute ? trimmed : path.join(process.cwd(), trimmed);
    }

    async getDefaultRoot(): Promise<string> {
        return this.resolveDefaultRoot();
    }

    async inspectReadiness(workspaceRoot?: string): Promise<WorkspaceReadiness> {
        const root = workspaceRoot?.trim() ? this.normalizeUserPath(workspaceRoot) : this.resolveDefaultRoot();

        const rootExists = existsSync(root);
        const agentsExists = rootExists && existsSync(path.join(root, 'agents'));
        const sessionsExists = rootExists && existsSync(path.join(root, 'sessions'));

        return {
            workspaceRoot: root,
            rootExists,
            agentsExists,
            sessionsExists,
            needsRepair: !rootExists || !agentsExists || !sessionsExists,
            platform: this.platformName(),
            isWindows: process.platform === 'win32',
        };
    }

    async ensureReadiness(workspaceRoot?: string): Promise<WorkspaceReadiness> {
        const root = workspaceRoot?.trim() ? this.normalizeUserPath(workspaceRoot) : this.resolveDefaultRoot();

        for (const dir of [root, path.join(root, 'agents'), path.join(root, 'sessions'), path.join(root, 'logs')]) {
            await fs.mkdir(dir, { recursive: true });
        }

        return this.inspectReadiness(root);
    }

    async initAgent(workspacePath: string): Promise<void> {
        const normalized = this.normalizeUserPath(workspacePath.trim());
        if (!normalized) {
            throw new Error('workspace_path is empty');
        }

        await fs.mkdir(normalized, { recursive: true });
        const subdirs = ['skills', 'flows', 'tasks', 'knowledge'];
        await Promise.all(subdirs.map(sub => fs.mkdir(path.join(normalized, sub), { recursive: true })));
    }

    async mkdir(pathStr: string): Promise<void> {
        const normalized = this.normalizeUserPath(pathStr.trim());
        if (!normalized) {
            throw new Error('path is empty');
        }
        await fs.mkdir(normalized, { recursive: true });
    }

    async writeFile(pathStr: string, content: string): Promise<void> {
        const normalized = this.normalizeUserPath(pathStr.trim());
        if (!normalized) {
            throw new Error('path is empty');
        }
        await fs.mkdir(path.dirname(normalized), { recursive: true });
        await fs.writeFile(normalized, content, 'utf-8');
    }

    async readFile(pathStr: string): Promise<string> {
        const normalized = this.normalizeUserPath(pathStr.trim());
        return fs.readFile(normalized, 'utf-8');
    }

    async exists(pathStr: string): Promise<boolean> {
        const normalized = this.normalizeUserPath(pathStr.trim());
        return existsSync(normalized);
    }

    async stat(pathStr: string): Promise<WsDirEntry> {
        const normalized = this.normalizeUserPath(pathStr.trim());
        const stats = await fs.stat(normalized);
        const name = path.basename(normalized);
        const extension = stats.isFile() ? this.fileExtension(name).replace(/^\./, '') : undefined;

        return {
            name,
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile(),
            size: stats.isFile() ? stats.size : undefined,
            mtimeMs: stats.mtimeMs,
            modifiedAt: stats.mtime.toISOString(),
            extension,
            isBinary: stats.isFile() ? this.isBinaryFileName(name) : undefined,
        };
    }

    async remove(pathStr: string): Promise<void> {
        const normalized = this.normalizeUserPath(pathStr.trim());
        if (!existsSync(normalized)) {
            return;
        }

        const stat = await fs.stat(normalized);
        if (stat.isDirectory()) {
            await fs.rm(normalized, { recursive: true });
        } else {
            await fs.unlink(normalized);
        }
    }

    async readDir(pathStr: string): Promise<WsDirEntry[]> {
        const normalized = this.normalizeUserPath(pathStr.trim());
        if (!existsSync(normalized)) {
            return [];
        }

        const entries = await fs.readdir(normalized, { withFileTypes: true });
        return Promise.all(
            entries.map(async entry => {
                const absolutePath = path.join(normalized, entry.name);
                const stat = await fs.stat(absolutePath);
                const isFile = stat.isFile();
                const isDirectory = stat.isDirectory();
                const extension = isFile ? this.fileExtension(entry.name).replace(/^\./, '') : undefined;
                return {
                    name: entry.name,
                    isDirectory,
                    isFile,
                    size: isFile ? stat.size : undefined,
                    mtimeMs: stat.mtimeMs,
                    modifiedAt: stat.mtime.toISOString(),
                    extension,
                    isBinary: isFile ? this.isBinaryFileName(entry.name) : undefined,
                };
            }),
        );
    }

    async rename(src: string, dest: string): Promise<void> {
        const normalizedSrc = this.normalizeUserPath(src.trim());
        const normalizedDest = this.normalizeUserPath(dest.trim());
        await fs.mkdir(path.dirname(normalizedDest), { recursive: true });
        await fs.rename(normalizedSrc, normalizedDest);
    }

    async copyFile(src: string, dest: string): Promise<void> {
        const normalizedSrc = this.normalizeUserPath(src.trim());
        const normalizedDest = this.normalizeUserPath(dest.trim());
        await fs.mkdir(path.dirname(normalizedDest), { recursive: true });
        await fs.copyFile(normalizedSrc, normalizedDest);
    }

    async readBinaryFile(pathStr: string): Promise<Buffer> {
        const normalized = this.normalizeUserPath(pathStr.trim());
        return fs.readFile(normalized);
    }

    async writeBinaryFile(pathStr: string, data: Buffer): Promise<void> {
        const normalized = this.normalizeUserPath(pathStr.trim());
        if (!normalized) {
            throw new Error('path is empty');
        }
        await fs.mkdir(path.dirname(normalized), { recursive: true });
        await fs.writeFile(normalized, data);
    }

    async searchInFiles(
        rootPath: string,
        query: string,
        options?: {
            caseSensitive?: boolean;
            useRegex?: boolean;
            matchWholeWord?: boolean;
            includePattern?: string;
            excludePattern?: string;
            maxResults?: number;
        },
    ): Promise<SearchResult[]> {
        const normalized = this.normalizeUserPath(rootPath.trim());
        const results: SearchResult[] = [];
        const maxResults = options?.maxResults || 1000;
        const includePatterns = this.parseSearchPatternList(options?.includePattern);
        const excludePatterns = this.parseSearchPatternList(options?.excludePattern);

        let searchPattern: RegExp;
        let useRegex = false;
        try {
            const compiled = this.createSearchPattern(query, options);
            searchPattern = compiled.pattern;
            useRegex = compiled.useRegex;
        } catch (error) {
            throw new Error(`Invalid search pattern: ${error.message}`);
        }

        const searchInDirectory = async (dirPath: string): Promise<void> => {
            if (results.length >= maxResults) return;

            try {
                const entries = await fs.readdir(dirPath, { withFileTypes: true });

                for (const entry of entries) {
                    if (results.length >= maxResults) break;

                    const fullPath = path.join(dirPath, entry.name);
                    const relativePath = path.relative(normalized, fullPath);

                    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
                        continue;
                    }

                    if (excludePatterns.length > 0 && this.matchesAnySearchPattern(relativePath, excludePatterns)) {
                        continue;
                    }

                    if (entry.isDirectory()) {
                        await searchInDirectory(fullPath);
                    } else if (
                        entry.isFile() &&
                        !this.isBinaryFileName(entry.name) &&
                        this.shouldSearchFile(relativePath, includePatterns, excludePatterns)
                    ) {
                        try {
                            const content = await fs.readFile(fullPath, 'utf-8');
                            const lines = content.split('\n');
                            const matches: SearchMatch[] = [];

                            for (let i = 0; i < lines.length; i++) {
                                const line = lines[i];
                                searchPattern.lastIndex = 0;
                                let match: RegExpExecArray | null;

                                while ((match = searchPattern.exec(line)) !== null) {
                                    matches.push({
                                        line: i + 1,
                                        column: match.index + 1,
                                        text: line,
                                        matchStart: match.index,
                                        matchEnd: match.index + match[0].length,
                                    });

                                    if (match[0].length === 0) {
                                        searchPattern.lastIndex += 1;
                                    }

                                    if (!useRegex || !searchPattern.global) break;
                                }
                            }

                            if (matches.length > 0) {
                                results.push({
                                    path: relativePath,
                                    matches,
                                });
                            }
                        } catch {
                            // Skip files that can't be read as text
                        }
                    }
                }
            } catch {
                // Skip directories that can't be read
            }
        };

        await searchInDirectory(normalized);
        return results;
    }

    async replaceInFiles(
        rootPath: string,
        query: string,
        replacement: string,
        options?: {
            caseSensitive?: boolean;
            useRegex?: boolean;
            matchWholeWord?: boolean;
            includePattern?: string;
            excludePattern?: string;
            filePaths?: string[];
        },
    ): Promise<ReplaceResult> {
        const normalized = this.normalizeUserPath(rootPath.trim());
        const filePaths = options?.filePaths;
        const includePatterns = this.parseSearchPatternList(options?.includePattern);
        const excludePatterns = this.parseSearchPatternList(options?.excludePattern);

        let searchPattern: RegExp;
        try {
            searchPattern = this.createSearchPattern(query, options).pattern;
        } catch (error) {
            throw new Error(`Invalid search pattern: ${error.message}`);
        }

        const result: ReplaceResult = {
            filesModified: 0,
            totalReplacements: 0,
            files: [],
        };

        const filesToProcess: string[] = [];

        if (filePaths && filePaths.length > 0) {
            // Replace in specific files
            for (const relativePath of filePaths) {
                const fullPath = path.join(normalized, relativePath);
                filesToProcess.push(fullPath);
            }
        } else {
            // Replace in all files
            const collectFiles = async (dirPath: string): Promise<void> => {
                try {
                    const entries = await fs.readdir(dirPath, { withFileTypes: true });

                    for (const entry of entries) {
                        const fullPath = path.join(dirPath, entry.name);

                        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
                            continue;
                        }

                        const relativePath = path.relative(normalized, fullPath).replace(/\\/g, '/');
                        if (excludePatterns.length > 0 && this.matchesAnySearchPattern(relativePath, excludePatterns)) {
                            continue;
                        }

                        if (entry.isDirectory()) {
                            await collectFiles(fullPath);
                        } else if (
                            entry.isFile() &&
                            !this.isBinaryFileName(entry.name) &&
                            this.shouldSearchFile(relativePath, includePatterns, excludePatterns)
                        ) {
                            filesToProcess.push(fullPath);
                        }
                    }
                } catch {
                    // Skip directories that can't be read
                }
            };

            await collectFiles(normalized);
        }

        for (const fullPath of filesToProcess) {
            try {
                const content = await fs.readFile(fullPath, 'utf-8');
                let replacementCount = 0;
                const newContent = content.replace(searchPattern, () => {
                    replacementCount++;
                    return replacement;
                });

                if (replacementCount > 0) {
                    await fs.writeFile(fullPath, newContent, 'utf-8');
                    const relativePath = path.relative(normalized, fullPath);
                    result.files.push({
                        path: relativePath,
                        replacements: replacementCount,
                    });
                    result.filesModified++;
                    result.totalReplacements += replacementCount;
                }
            } catch {
                // Skip files that can't be read or written
            }
        }

        return result;
    }
}

export const LocalFileStorageProvider = {
    provide: WORKSPACE_STORAGE,
    useClass: LocalFileStorage,
};
