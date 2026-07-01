import { Injectable } from '@nestjs/common';
import { existsSync, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TextDecoder } from 'util';
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
    private static readonly MAX_READ_TEXT_BYTES = 512 * 1024;

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
        '.svg',
        '.toml',
        '.ts',
        '.tsx',
        '.txt',
        '.xml',
        '.yaml',
        '.yml',
        '.zsh',
    ]);

    private readonly imageExtensions = new Set([
        '.avif',
        '.bmp',
        '.gif',
        '.ico',
        '.jpeg',
        '.jpg',
        '.png',
        '.webp',
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
        const ext = this.fileExtension(normalized);
        if (ext === '.pdf') {
            return this.readPdfText(normalized);
        }
        if (this.imageExtensions.has(ext)) {
            return this.describeImageFile(normalized, ext);
        }

        const data = await fs.readFile(normalized);
        return this.decodeUtf8Text(data, normalized);
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

    private async readPdfText(filePath: string): Promise<string> {
        const data = await fs.readFile(filePath);
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data });
        try {
            const result = await parser.getText();
            const text = result.text.trim();
            const pageCount = typeof result.total === 'number' ? result.total : undefined;
            const header = [
                `File: ${filePath}`,
                `Type: PDF document`,
                pageCount !== undefined ? `Pages: ${pageCount}` : undefined,
                '',
            ].filter((line): line is string => line !== undefined);
            if (!text) {
                return `${header.join('\n')}\nNo extractable text was found in this PDF. It may be scanned, image-only, or otherwise not text-based.`;
            }
            const truncated = this.truncateReadText(text);
            return `${header.join('\n')}\n${truncated}`;
        } catch (error) {
            return [
                `File: ${filePath}`,
                'Type: PDF document',
                `Size: ${data.length} bytes`,
                '',
                `PDF text extraction failed: ${error instanceof Error ? error.message : String(error)}`,
                'The file may be encrypted, corrupted, or image-only. Use a PDF-specific preview or format-specific parser to inspect it.',
            ].join('\n');
        } finally {
            await parser.destroy().catch(() => undefined);
        }
    }

    private async describeImageFile(filePath: string, ext: string): Promise<string> {
        const data = await fs.readFile(filePath);
        const dimensions = this.imageDimensions(data, ext);
        return [
            `File: ${filePath}`,
            `Type: ${this.imageTypeLabel(ext)}`,
            `Size: ${data.length} bytes`,
            dimensions ? `Dimensions: ${dimensions.width}x${dimensions.height}` : undefined,
            '',
            'This is an image file. Binary image bytes cannot be read as UTF-8 text.',
            'Use an image preview or vision-capable attachment path to analyze visible content.',
        ].filter((line): line is string => line !== undefined).join('\n');
    }

    private decodeUtf8Text(data: Buffer, filePath: string): string {
        try {
            const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
            return this.truncateReadText(text);
        } catch {
            return [
                `File: ${filePath}`,
                `Type: binary or non-UTF-8 file`,
                `Size: ${data.length} bytes`,
                '',
                'This file could not be decoded as UTF-8 text.',
                'Use a binary reader or a format-specific parser instead of the text read tool.',
            ].join('\n');
        }
    }

    private truncateReadText(text: string): string {
        const bytes = Buffer.byteLength(text, 'utf8');
        if (bytes <= LocalFileStorage.MAX_READ_TEXT_BYTES) {
            return text;
        }

        let used = 0;
        let output = '';
        for (const char of text) {
            const size = Buffer.byteLength(char, 'utf8');
            if (used + size > LocalFileStorage.MAX_READ_TEXT_BYTES) break;
            used += size;
            output += char;
        }
        return `${output}\n\n[Read output truncated after ${LocalFileStorage.MAX_READ_TEXT_BYTES} bytes.]`;
    }

    private imageTypeLabel(ext: string): string {
        switch (ext) {
            case '.png':
                return 'PNG image';
            case '.jpg':
            case '.jpeg':
                return 'JPEG image';
            case '.gif':
                return 'GIF image';
            case '.webp':
                return 'WebP image';
            case '.svg':
                return 'SVG image';
            case '.bmp':
                return 'BMP image';
            case '.ico':
                return 'ICO image';
            case '.avif':
                return 'AVIF image';
            default:
                return 'image file';
        }
    }

    private imageDimensions(data: Buffer, ext: string): { width: number; height: number } | null {
        if (ext === '.png') {
            return this.pngDimensions(data);
        }
        if (ext === '.jpg' || ext === '.jpeg') {
            return this.jpegDimensions(data);
        }
        if (ext === '.gif') {
            return data.length >= 10 ? { width: data.readUInt16LE(6), height: data.readUInt16LE(8) } : null;
        }
        if (ext === '.webp') {
            return this.webpDimensions(data);
        }
        return null;
    }

    private pngDimensions(data: Buffer): { width: number; height: number } | null {
        const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        if (data.length < 24 || !data.subarray(0, 8).equals(pngSignature)) return null;
        return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
    }

    private jpegDimensions(data: Buffer): { width: number; height: number } | null {
        if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
        let offset = 2;
        while (offset + 9 < data.length) {
            if (data[offset] !== 0xff) return null;
            const marker = data[offset + 1];
            const length = data.readUInt16BE(offset + 2);
            if (length < 2) return null;
            if (
                (marker >= 0xc0 && marker <= 0xc3) ||
                (marker >= 0xc5 && marker <= 0xc7) ||
                (marker >= 0xc9 && marker <= 0xcb) ||
                (marker >= 0xcd && marker <= 0xcf)
            ) {
                return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) };
            }
            offset += 2 + length;
        }
        return null;
    }

    private webpDimensions(data: Buffer): { width: number; height: number } | null {
        if (
            data.length < 30 ||
            data.toString('ascii', 0, 4) !== 'RIFF' ||
            data.toString('ascii', 8, 12) !== 'WEBP'
        ) {
            return null;
        }
        const chunkType = data.toString('ascii', 12, 16);
        if (chunkType === 'VP8X' && data.length >= 30) {
            return {
                width: 1 + data.readUIntLE(24, 3),
                height: 1 + data.readUIntLE(27, 3),
            };
        }
        if (chunkType === 'VP8 ' && data.length >= 30) {
            return {
                width: data.readUInt16LE(26) & 0x3fff,
                height: data.readUInt16LE(28) & 0x3fff,
            };
        }
        return null;
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
