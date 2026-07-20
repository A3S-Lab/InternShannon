import { parseDocument } from 'yaml';

export const OKF_VERSION = '0.1';
export const OKF_SPEC_REVISION = 'd44368c15e38e7c92481c5992e4f9b5b421a801d';
export const OKF_SPEC_SOURCE = 'https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf';

export type OkfFrontmatter = Record<string, unknown>;

export interface OkfDocument {
    path: string;
    reserved: boolean;
    frontmatter: OkfFrontmatter;
    body: string;
    raw: string;
}

export interface OkfDiagnostic {
    severity: 'error' | 'warning';
    path: string;
    code: string;
    message: string;
}

export interface OkfConceptSummary {
    conceptId: string;
    path: string;
    type: string;
    title: string;
    description?: string;
    resource?: string;
    tags: string[];
    timestamp?: string;
    extensions: Record<string, unknown>;
}

export interface OkfBundleValidation {
    valid: boolean;
    version: string;
    documentCount: number;
    conceptCount: number;
    concepts: OkfConceptSummary[];
    diagnostics: OkfDiagnostic[];
}

export interface OkfLink {
    rawTarget: string;
    resolvedPath: string | null;
}

const RECOMMENDED_FIELDS = new Set(['type', 'title', 'description', 'resource', 'tags', 'timestamp']);

export function normalizeOkfPath(value: string): string | null {
    const segments: string[] = [];
    for (const rawSegment of value.replace(/\\/g, '/').split('/')) {
        const segment = rawSegment.trim();
        if (!segment || segment === '.') continue;
        if (segment === '..') {
            if (segments.length === 0) return null;
            segments.pop();
            continue;
        }
        if (segment.includes('\0')) return null;
        segments.push(segment);
    }
    return segments.join('/');
}

export function parseOkfDocument(path: string, raw: string): OkfDocument {
    const normalizedPath = normalizeOkfPath(path);
    if (!normalizedPath) throw new Error('OKF document path is empty or unsafe');
    const reserved = isReservedOkfPath(normalizedPath);
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
    if (!match) {
        return { path: normalizedPath, reserved, frontmatter: {}, body: raw, raw };
    }

    const document = parseDocument(match[1]);
    if (document.errors.length > 0) {
        throw new Error(document.errors.map(error => error.message).join('; '));
    }
    const parsed = document.toJS();
    if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
        throw new Error('OKF frontmatter must be a YAML mapping');
    }
    return {
        path: normalizedPath,
        reserved,
        frontmatter: (parsed ?? {}) as OkfFrontmatter,
        body: raw.slice(match[0].length),
        raw,
    };
}

export function validateOkfBundle(files: Record<string, string>): OkfBundleValidation {
    const diagnostics: OkfDiagnostic[] = [];
    const documents: OkfDocument[] = [];
    for (const [inputPath, raw] of Object.entries(files)) {
        const path = normalizeOkfPath(inputPath);
        if (!path) {
            diagnostics.push({
                severity: 'error',
                path: inputPath,
                code: 'unsafe_path',
                message: '文档路径为空或包含越界跳转',
            });
            continue;
        }
        if (!path.toLowerCase().endsWith('.md')) continue;
        try {
            documents.push(parseOkfDocument(path, raw));
        } catch (error) {
            diagnostics.push({
                severity: 'error',
                path,
                code: 'invalid_frontmatter',
                message: error instanceof Error ? error.message : 'YAML frontmatter 无法解析',
            });
        }
    }

    if (documents.length === 0) {
        diagnostics.push({
            severity: 'error',
            path: '',
            code: 'empty_bundle',
            message: 'OKF bundle 至少需要一个 Markdown 文档',
        });
    }

    const rootIndex = documents.find(document => document.path.toLowerCase() === 'index.md');
    const declaredVersion = stringValue(rootIndex?.frontmatter.okf_version);
    if (!declaredVersion) {
        diagnostics.push({
            severity: 'warning',
            path: 'index.md',
            code: 'implicit_version',
            message: `未声明 okf_version，按 ${OKF_VERSION} 兼容读取`,
        });
    } else if (declaredVersion !== OKF_VERSION) {
        diagnostics.push({
            severity: 'warning',
            path: 'index.md',
            code: 'unknown_version',
            message: `当前实现针对 OKF ${OKF_VERSION}，将尽力读取 ${declaredVersion}`,
        });
    }

    const concepts: OkfConceptSummary[] = [];
    for (const document of documents) {
        if (document.reserved) continue;
        const type = stringValue(document.frontmatter.type);
        if (!type) {
            diagnostics.push({
                severity: 'error',
                path: document.path,
                code: 'missing_type',
                message: 'OKF concept 必须包含非空 type',
            });
            continue;
        }
        const title = stringValue(document.frontmatter.title) || titleFromPath(document.path);
        const extensions = Object.fromEntries(
            Object.entries(document.frontmatter).filter(([key]) => !RECOMMENDED_FIELDS.has(key)),
        );
        concepts.push({
            conceptId: document.path.replace(/\.md$/i, ''),
            path: document.path,
            type,
            title,
            description: stringValue(document.frontmatter.description) || undefined,
            resource: stringValue(document.frontmatter.resource) || undefined,
            tags: stringArray(document.frontmatter.tags),
            timestamp: stringValue(document.frontmatter.timestamp) || undefined,
            extensions,
        });
    }

    const paths = new Set(documents.map(document => document.path.toLowerCase()));
    for (const document of documents) {
        for (const link of extractOkfLinks(document.path, document.body)) {
            if (link.resolvedPath && !paths.has(link.resolvedPath.toLowerCase())) {
                diagnostics.push({
                    severity: 'warning',
                    path: document.path,
                    code: 'broken_link',
                    message: `链接目标不存在：${link.rawTarget}`,
                });
            }
        }
    }

    return {
        valid: diagnostics.every(diagnostic => diagnostic.severity !== 'error'),
        version: declaredVersion || OKF_VERSION,
        documentCount: documents.length,
        conceptCount: concepts.length,
        concepts,
        diagnostics,
    };
}

export function extractOkfLinks(sourcePath: string, markdown: string): OkfLink[] {
    const links: OkfLink[] = [];
    const pattern = /(^|[^!])\[[^\]\n]*\]\(([^)\n]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(markdown)) !== null) {
        const rawTarget = cleanMarkdownTarget(match[2]);
        if (!rawTarget) continue;
        links.push({ rawTarget, resolvedPath: resolveOkfLink(sourcePath, rawTarget) });
    }
    return links;
}

export function resolveOkfLink(sourcePath: string, rawTarget: string): string | null {
    let target = cleanMarkdownTarget(rawTarget);
    if (!target || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) {
        return null;
    }
    target = target.split('#')[0].split('?')[0];
    try {
        target = decodeURIComponent(target);
    } catch {
        // Keep the original target for best-effort resolution.
    }
    const sourceDirectory = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : '';
    const candidate = target.startsWith('/') ? target.slice(1) : `${sourceDirectory}/${target}`;
    const directoryTarget = target.endsWith('/');
    const normalized = normalizeOkfPath(candidate);
    if (!normalized) return null;
    return directoryTarget ? `${normalized}/index.md` : normalized;
}

export function isReservedOkfPath(path: string): boolean {
    const name = path.split('/').pop()?.toLowerCase();
    return name === 'index.md' || name === 'log.md';
}

function cleanMarkdownTarget(value: string): string {
    const trimmed = value.trim().replace(/^<|>$/g, '');
    const titleSeparator = /\s+["']/.exec(trimmed);
    return titleSeparator?.index === undefined ? trimmed : trimmed.slice(0, titleSeparator.index);
}

function titleFromPath(path: string): string {
    const name = path.split('/').pop() || path;
    return name.replace(/\.md$/i, '').replace(/[-_]+/g, ' ');
}

function stringValue(value: unknown): string {
    if (value instanceof Date) return value.toISOString();
    return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function stringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map(stringValue).filter(Boolean);
}
