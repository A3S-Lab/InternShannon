import { Inject, Injectable } from '@nestjs/common';
import { NotFoundException } from '@/shared/common/errors';
import type { Asset } from '../domain/entities/asset.entity';
import { isInternalKnowledgePath, isPublicKnowledgeSourcePath } from '../domain/knowledge/knowledge-source-path.policy';
import { ASSET_SERVICE, type IAssetService } from '../domain/services/asset.service.interface';

export interface KnowledgePageEntry {
    path: string;
    title: string;
    type: string | null;
    sources: string[];
    tags: string[];
}

export interface KnowledgeSourceEntry {
    path: string;
    name: string;
    size: number;
}

@Injectable()
export class KnowledgeContentService {
    constructor(@Inject(ASSET_SERVICE) private readonly assets: IAssetService) {}

    async requireAsset(id: string): Promise<Asset> {
        const asset = await this.assets.getAsset(id);
        if (!asset) throw new NotFoundException('Asset not found');
        return asset;
    }

    async loadContents(asset: Asset, prefix: string): Promise<Record<string, string>> {
        const cached = this.blobContents(asset);
        const paths = new Set([
            ...Object.keys(cached).filter(path => path.startsWith(prefix) && !isInternalKnowledgePath(path)),
            ...(asset.blobs ?? [])
                .filter(blob => !blob.isBinary && blob.path.startsWith(prefix) && !isInternalKnowledgePath(blob.path))
                .map(blob => blob.path),
        ]);
        const pairs = await Promise.all(
            Array.from(paths).map(async path => {
                const content = cached[path] ?? (await this.assets.getBlobContent(asset.id, path).catch(() => null));
                return content === null ? null : ([path, content] as const);
            }),
        );
        return Object.fromEntries(pairs.filter((pair): pair is readonly [string, string] => pair !== null));
    }

    pageEntries(asset: Asset, contents = this.blobContents(asset)): KnowledgePageEntry[] {
        return Object.entries(contents)
            .filter(([path]) =>
                path.startsWith('wiki/') && path.toLowerCase().endsWith('.md') && !isInternalKnowledgePath(path),
            )
            .map(([path, content]) => {
                const frontmatter = this.readFrontmatter(content);
                return {
                    path,
                    title: frontmatter.title || this.titleFromPath(path),
                    type: frontmatter.type?.trim() || null,
                    sources: frontmatter.sources ?? [],
                    tags: frontmatter.tags ?? [],
                };
            })
            .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));
    }

    sourceEntries(asset: Asset): KnowledgeSourceEntry[] {
        const contents = this.blobContents(asset);
        const blobsByPath = new Map((asset.blobs ?? []).map(blob => [blob.path, blob]));
        const paths = new Set([
            ...Object.keys(contents).filter(isPublicKnowledgeSourcePath),
            ...(asset.blobs ?? []).map(blob => blob.path).filter(isPublicKnowledgeSourcePath),
        ]);
        return Array.from(paths)
            .map(path => ({
                path,
                name: path.split('/').pop() || path,
                size: blobsByPath.get(path)?.size ?? Buffer.byteLength(contents[path] ?? '', 'utf8'),
            }))
            .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
    }

    blobContents(asset: Asset): Record<string, string> {
        const contents = asset.metadata?.blobContents;
        return contents && typeof contents === 'object' && !Array.isArray(contents)
            ? (contents as Record<string, string>)
            : {};
    }

    knowledgeMetadata(asset: Asset): Record<string, unknown> {
        const knowledge = asset.metadata?.knowledge;
        return knowledge && typeof knowledge === 'object' && !Array.isArray(knowledge)
            ? (knowledge as Record<string, unknown>)
            : {};
    }

    titleFromPath(path: string): string {
        const name = path.split('/').pop() || path;
        return name.replace(/\.[^.]+$/, '') || name;
    }

    titleFromSourcePath(path: string): string {
        return decodeURIComponent(path.split('/').pop() || path).replace(/[-_]+/g, ' ');
    }

    isReservedWikiPage(path: string): boolean {
        const normalized = path.toLowerCase();
        return (
            normalized === 'wiki/index.md' ||
            normalized === 'wiki/log.md' ||
            normalized === 'wiki/overview.md' ||
            normalized === 'wiki/purpose.md' ||
            normalized === 'wiki/schema.md'
        );
    }

    private readFrontmatter(content: string): {
        title?: string;
        type?: string;
        tags?: string[];
        sources?: string[];
    } {
        const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
        if (!match) return {};
        const result: { title?: string; type?: string; tags?: string[]; sources?: string[] } = {};
        for (const line of match[1].split(/\r?\n/)) {
            const separator = line.indexOf(':');
            if (separator <= 0) continue;
            const key = line.slice(0, separator).trim();
            const value = line.slice(separator + 1).trim();
            if (key === 'title') result.title = value.replace(/^['"]|['"]$/g, '');
            if (key === 'type') result.type = value.replace(/^['"]|['"]$/g, '');
            if (key === 'tags') result.tags = this.readInlineList(value);
            if (key === 'sources') result.sources = this.readInlineList(value);
        }
        return result;
    }

    private readInlineList(value: string): string[] {
        return value
            .replace(/^\[|\]$/g, '')
            .split(',')
            .map(item => item.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);
    }
}
