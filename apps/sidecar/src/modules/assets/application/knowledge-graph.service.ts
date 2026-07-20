import { Injectable } from '@nestjs/common';
import { extractOkfLinks } from '../domain/knowledge/open-knowledge-format';
import { KnowledgeContentService, type KnowledgePageEntry } from './knowledge-content.service';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';

export interface KnowledgeGraphNode {
    path: string;
    title: string;
    type: string | null;
    tags: string[];
    sourceCount: number;
    degree: number;
    kind: 'concept' | 'source';
    community: number;
}

export interface KnowledgeGraphEdge {
    source: string;
    target: string;
    weight: number;
    kind: 'concept-link' | 'source-concept';
    signals: {
        directLink: number;
        sourceOverlap: number;
        adamicAdar: number;
        typeAffinity: number;
    };
}

export interface KnowledgeGraphResult {
    nodes: KnowledgeGraphNode[];
    edges: KnowledgeGraphEdge[];
    filters: {
        types: string[];
        tags: string[];
    };
}

export interface KnowledgeGraphFilters {
    query?: string;
    type?: string;
    tag?: string;
}

export interface KnowledgeLinkAnalysis {
    incomingPaths: Set<string>;
    brokenLinks: Array<{ srcPath: string; srcTitle: string; target: string }>;
    linkCount: number;
}

@Injectable()
export class KnowledgeGraphService {
    constructor(
        private readonly content: KnowledgeContentService,
        private readonly ingestion: KnowledgeIngestionService,
    ) {}

    async graph(id: string, filters: KnowledgeGraphFilters = {}): Promise<KnowledgeGraphResult> {
        const asset = await this.content.requireAsset(id);
        const contents = await this.content.loadContents(asset, 'wiki/');
        const pages = this.content.pageEntries(asset, contents);
        const byAlias = this.pageAliases(pages);

        const edgeWeights = new Map<string, { source: string; target: string; weight: number }>();
        for (const page of pages) {
            const pageContent = contents[page.path] ?? '';
            for (const targetAlias of this.knowledgeLinkTargets(page.path, pageContent)) {
                const target = byAlias.get(targetAlias.toLowerCase());
                if (!target || target === page.path) continue;
                const key = `${page.path}\n${target}`;
                const previous = edgeWeights.get(key);
                edgeWeights.set(key, {
                    source: page.path,
                    target,
                    weight: (previous?.weight ?? 0) + 1,
                });
            }
        }

        const degree = new Map<string, number>();
        const edges: KnowledgeGraphEdge[] = Array.from(edgeWeights.values()).map((edge) => {
            degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
            degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
            return {
                ...edge,
                kind: 'concept-link',
                signals: {
                    directLink: edge.weight,
                    sourceOverlap: 0,
                    adamicAdar: 0,
                    typeAffinity: 0,
                },
            };
        });

        const sourceNodes = new Map<string, { path: string; title: string; type: string; tags: string[] }>();
        for (const page of pages) {
            for (const source of page.sources) {
                if (!source.startsWith('raw/sources/')) continue;
                sourceNodes.set(source, {
                    path: source,
                    title: this.content.titleFromSourcePath(source),
                    type: 'Source',
                    tags: [],
                });
                degree.set(source, (degree.get(source) ?? 0) + 1);
                degree.set(page.path, (degree.get(page.path) ?? 0) + 1);
                edges.push({
                    source,
                    target: page.path,
                    weight: 1,
                    kind: 'source-concept',
                    signals: {
                        directLink: 1,
                        sourceOverlap: 1,
                        adamicAdar: 0,
                        typeAffinity: 0,
                    },
                });
            }
        }

        const nodesWithoutCommunity = [
            ...pages.map((page) => ({
                path: page.path,
                title: page.title,
                type: page.type,
                tags: page.tags,
                sourceCount: page.sources.length,
                degree: degree.get(page.path) ?? 0,
                kind: 'concept' as const,
            })),
            ...Array.from(sourceNodes.values()).map((source) => ({
                ...source,
                sourceCount: 0,
                degree: degree.get(source.path) ?? 0,
                kind: 'source' as const,
            })),
        ];
        const communities = this.graphCommunities(
            nodesWithoutCommunity.map((node) => node.path),
            edges,
        );
        const normalizedQuery = filters.query?.trim().toLowerCase();
        const normalizedType = filters.type?.trim().toLowerCase();
        const normalizedTag = filters.tag?.trim().toLowerCase();
        const nodes = nodesWithoutCommunity
            .filter((node) => {
                if (normalizedQuery && !`${node.title} ${node.path}`.toLowerCase().includes(normalizedQuery)) {
                    return false;
                }
                if (normalizedType && (node.type || '').toLowerCase() !== normalizedType) return false;
                if (normalizedTag && !node.tags.some((tag) => tag.toLowerCase() === normalizedTag)) return false;
                return true;
            })
            .map((node) => ({ ...node, community: communities.get(node.path) ?? 0 }));
        const visible = new Set(nodes.map((node) => node.path));

        return {
            nodes,
            edges: edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target)),
            filters: {
                types: Array.from(
                    new Set(nodesWithoutCommunity.map((node) => node.type).filter(Boolean)),
                ).sort() as string[],
                tags: Array.from(new Set(nodesWithoutCommunity.flatMap((node) => node.tags))).sort(),
            },
        };
    }

    async backlinks(id: string, path: string) {
        const [graph, asset] = await Promise.all([this.graph(id), this.content.requireAsset(id)]);
        const pages = new Map(
            this.content
                .pageEntries(asset, await this.content.loadContents(asset, 'wiki/'))
                .map((page) => [page.path, page]),
        );
        return {
            path,
            backlinks: graph.edges
                .filter((edge) => edge.target === path)
                .map((edge) => pages.get(edge.source))
                .filter((page): page is KnowledgePageEntry => Boolean(page)),
        };
    }

    async health(id: string) {
        const asset = await this.content.requireAsset(id);
        const contents = await this.content.loadContents(asset, 'wiki/');
        const pages = this.content.pageEntries(asset, contents);
        const sources = this.content.sourceEntries(asset);
        const manifest = await this.ingestion.getManifest(asset.id);
        const analysis = this.linkAnalysis(pages, contents);
        return {
            pageCount: pages.length,
            sourceCount: sources.length,
            ingestedSourceCount: manifest.sources.filter((source) => source.status === 'indexed').length,
            waitingForOcrCount: manifest.sources.filter((source) => source.status === 'waiting_for_ocr').length,
            ingestionErrorCount: manifest.sources.filter((source) => source.status === 'error').length,
            lastIngestedAt: manifest.generatedAt || null,
            taggedPageCount: pages.filter((page) => page.tags.length > 0).length,
            brokenLinks: analysis.brokenLinks,
            orphanPages: pages
                .filter((page) => !analysis.incomingPaths.has(page.path) && !this.content.isReservedWikiPage(page.path))
                .map((page) => ({
                    path: page.path,
                    title: page.title,
                    type: page.type,
                })),
        };
    }

    async summary(id: string) {
        const asset = await this.content.requireAsset(id);
        const contents = await this.content.loadContents(asset, 'wiki/');
        const pages = this.content.pageEntries(asset, contents);
        const analysis = this.linkAnalysis(pages, contents);
        return {
            nodeCount: pages.length,
            linkCount: analysis.linkCount,
            brokenLinkCount: analysis.brokenLinks.length,
        };
    }

    linkAnalysis(pages: KnowledgePageEntry[], contents: Record<string, string>): KnowledgeLinkAnalysis {
        const byAlias = this.pageAliases(pages);
        const incomingPaths = new Set<string>();
        const brokenLinks: KnowledgeLinkAnalysis['brokenLinks'] = [];
        let linkCount = 0;
        for (const page of pages) {
            for (const targetAlias of this.knowledgeLinkTargets(page.path, contents[page.path] ?? '')) {
                const targetPath = byAlias.get(targetAlias.toLowerCase());
                if (targetPath) {
                    if (targetPath !== page.path) incomingPaths.add(targetPath);
                    linkCount += 1;
                } else {
                    brokenLinks.push({
                        srcPath: page.path,
                        srcTitle: page.title,
                        target: targetAlias,
                    });
                }
            }
        }
        return { incomingPaths, brokenLinks, linkCount };
    }

    private pageAliases(pages: KnowledgePageEntry[]): Map<string, string> {
        const byAlias = new Map<string, string>();
        for (const page of pages) {
            byAlias.set(page.title.toLowerCase(), page.path);
            byAlias.set(this.content.titleFromPath(page.path).toLowerCase(), page.path);
            byAlias.set(page.path.toLowerCase(), page.path);
        }
        return byAlias;
    }

    private knowledgeLinkTargets(sourcePath: string, content: string): string[] {
        const targets = this.wikilinks(content);
        const bundlePath = sourcePath.replace(/^wiki\//i, '');
        for (const link of extractOkfLinks(bundlePath, content)) {
            if (link.resolvedPath) targets.push(`wiki/${link.resolvedPath}`);
        }
        return targets;
    }

    private wikilinks(content: string): string[] {
        const links: string[] = [];
        const pattern = /\[\[([^\]\n|#]+)(?:[|#][^\]\n]+)?\]\]/g;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(content)) !== null) {
            const target = match[1]?.trim();
            if (target) links.push(target);
        }
        return links;
    }

    private graphCommunities(paths: string[], edges: Array<{ source: string; target: string }>): Map<string, number> {
        const adjacency = new Map(paths.map((path) => [path, new Set<string>()]));
        for (const edge of edges) {
            adjacency.get(edge.source)?.add(edge.target);
            adjacency.get(edge.target)?.add(edge.source);
        }
        const communities = new Map<string, number>();
        let community = 0;
        for (const path of paths) {
            if (communities.has(path)) continue;
            const queue = [path];
            communities.set(path, community);
            while (queue.length > 0) {
                const current = queue.shift();
                if (!current) continue;
                for (const neighbor of adjacency.get(current) ?? []) {
                    if (communities.has(neighbor)) continue;
                    communities.set(neighbor, community);
                    queue.push(neighbor);
                }
            }
            community += 1;
        }
        return communities;
    }
}
