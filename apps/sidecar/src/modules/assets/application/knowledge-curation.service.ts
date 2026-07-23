import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { BadRequestException, ConflictException, NotFoundException } from '@/shared/common/errors';
import { ASSET_SERVICE, type IAssetService } from '../domain/services/asset.service.interface';
import { KnowledgeAuditService } from './knowledge-audit.service';
import { KnowledgeContentService, type KnowledgePageEntry } from './knowledge-content.service';
import { KnowledgeGraphService } from './knowledge-graph.service';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';
import { KnowledgeQueryService } from './knowledge-query.service';

export type KnowledgeCurationDecision = 'accept' | 'reject' | 'revert';

export interface KnowledgeCurationSuggestion {
    id: string;
    kind: 'link' | 'summary' | 'page' | 'merge';
    status: 'pending' | 'accepted' | 'rejected' | 'reverted';
    sourcePath: string;
    targetPath: string;
    targetTitle: string;
    reason: string;
    similarity: number;
    createdAt: string;
    reviewedAt?: string;
    reviewedBy?: string;
    appliedText?: string;
    appliedContentSha?: string;
    commitSha?: string;
    proposedContent?: string;
    citations?: string[];
    appliedMode?: 'append' | 'create';
    applicationState?: 'applying' | 'reverting';
    originalContentSha?: string;
    revertedContentSha?: string;
}

@Injectable()
export class KnowledgeCurationService {
    private readonly queues = new Map<string, Promise<void>>();

    constructor(
        @Inject(ASSET_SERVICE) private readonly assets: IAssetService,
        private readonly content: KnowledgeContentService,
        private readonly graph: KnowledgeGraphService,
        private readonly ingestion: KnowledgeIngestionService,
        private readonly knowledge: KnowledgeQueryService,
        private readonly audit: KnowledgeAuditService,
    ) {}

    async status(id: string) {
        const asset = await this.content.requireAsset(id);
        const suggestions = this.suggestions(asset);
        const knowledge = this.content.knowledgeMetadata(asset);
        return {
            assetId: asset.id,
            personal: knowledge.personal === true,
            curationStatus: suggestions.some(item => item.status === 'pending') ? 'awaiting_review' : 'ready',
            pendingCount: suggestions.filter(item => item.status === 'pending').length,
            processedCount: suggestions.filter(item => item.status !== 'pending').length,
            lastCurationAt: this.stringMetadataValue(knowledge.lastCurationAt) || null,
            autoCuration: knowledge.autoCuration !== false,
            engineEnabled: true,
        };
    }

    async updateConfig(id: string, autoCuration: boolean, actorId: string) {
        const asset = await this.content.requireAsset(id);
        const knowledge = { ...this.content.knowledgeMetadata(asset), autoCuration };
        await this.assets.updateAsset(id, { metadata: { knowledge } });
        await this.audit.append(id, {
            action: 'config.update',
            target: 'curation.autoCuration',
            actorId,
            metadata: { autoCuration },
        });
        return { assetId: id, autoCuration };
    }

    async list(id: string) {
        const asset = await this.content.requireAsset(id);
        return { assetId: id, suggestions: this.suggestions(asset) };
    }

    async refreshAfterReindex(id: string) {
        const asset = await this.content.requireAsset(id);
        if (this.content.knowledgeMetadata(asset).autoCuration === false) return null;
        return this.refresh(id);
    }

    refresh(id: string) {
        return this.runSerially(id, () => this.refreshUnlocked(id));
    }

    review(id: string, suggestionId: string, actorId: string, decision: KnowledgeCurationDecision) {
        return this.runSerially(id, () => this.reviewUnlocked(id, suggestionId, actorId, decision));
    }

    async auditLog(id: string, limit: number) {
        return this.audit.list(id, limit);
    }

    private async refreshUnlocked(id: string) {
        const asset = await this.content.requireAsset(id);
        const existing = new Map(this.suggestions(asset).map(item => [item.id, item]));
        const graph = await this.graph.graph(id);
        const linked = new Set(graph.edges.flatMap(edge => [`${edge.source}|${edge.target}`, `${edge.target}|${edge.source}`]));
        const suggestions: KnowledgeCurationSuggestion[] = [];
        const now = new Date().toISOString();
        const contents = await this.content.loadContents(asset, 'wiki/');
        const allPages = this.content
            .pageEntries(asset, contents)
            .filter(page => !this.content.isReservedWikiPage(page.path));
        const pages = allPages.filter(page => !this.isManagedPage(page));
        const pagesByPath = new Map(pages.map(page => [page.path, page]));
        const pagePaths = new Set(pages.map(page => page.path));

        for (const page of pages) {
            const similar = await this.knowledge.findSimilarConcepts(id, page.path, 4).catch(() => ({ hits: [] }));
            for (const hit of similar.hits) {
                if (
                    !pagePaths.has(hit.path) ||
                    hit.path === page.path ||
                    linked.has(`${page.path}|${hit.path}`) ||
                    hit.similarity < 0.16
                ) {
                    continue;
                }
                const [sourcePath, targetPath] = [page.path, hit.path].sort();
                const suggestionId = createHash('sha1').update(`${sourcePath}|${targetPath}`).digest('hex');
                if (suggestions.some(item => item.id === suggestionId)) continue;
                const previous = this.refreshableSuggestion(existing.get(suggestionId));
                suggestions.push({
                    ...previous,
                    id: suggestionId,
                    kind: 'link',
                    status: previous?.status ?? 'pending',
                    sourcePath,
                    targetPath,
                    targetTitle: pagesByPath.get(targetPath)?.title ?? hit.title,
                    reason: `本地语义相似度 ${(hit.similarity * 100).toFixed(0)}%`,
                    similarity: hit.similarity,
                    createdAt: previous?.createdAt ?? now,
                    reviewedAt: previous?.reviewedAt,
                    reviewedBy: previous?.reviewedBy,
                });
                if (suggestions.length >= 30) break;
            }
            if (suggestions.length >= 30) break;
        }

        for (const page of pages.slice(0, 20)) {
            const pageContent = contents[page.path] ?? '';
            const summary = this.extractiveSummary(
                pageContent.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, ''),
            );
            if (!summary || /(^|\n)## Summary\s*(\n|$)/i.test(pageContent)) continue;
            const suggestionId = createHash('sha1').update(`summary:${page.path}:${summary}`).digest('hex');
            const previous = this.refreshableSuggestion(existing.get(suggestionId));
            suggestions.push({
                ...previous,
                id: suggestionId,
                kind: 'summary',
                status: previous?.status ?? 'pending',
                sourcePath: page.path,
                targetPath: page.path,
                targetTitle: page.title,
                reason: '根据页面正文生成可审阅摘要',
                similarity: 1,
                proposedContent: `\n\n## Summary\n\n${summary}\n`,
                citations: [page.path],
                createdAt: previous?.createdAt ?? now,
            });
        }

        const manifest = await this.ingestion.getManifest(id);
        const allPagePaths = new Set(allPages.map(page => page.path));
        for (const source of manifest.sources.filter(item => item.status === 'indexed').slice(0, 20)) {
            const chunks = await this.ingestion.readChunks(id, source);
            const excerpt = chunks[0]?.text.trim();
            if (!excerpt) continue;
            const targetPath = `wiki/generated/${this.slugFromSource(source.path)}.md`;
            if (allPagePaths.has(targetPath)) continue;
            const title = this.content.titleFromSourcePath(source.path);
            const summary = this.extractiveSummary(excerpt);
            const suggestionId = createHash('sha1').update(`page:${source.path}:${source.sha}`).digest('hex');
            const previous = this.refreshableSuggestion(existing.get(suggestionId));
            suggestions.push({
                ...previous,
                id: suggestionId,
                kind: 'page',
                status: previous?.status ?? 'pending',
                sourcePath: source.path,
                targetPath,
                targetTitle: title,
                reason: '根据已索引来源生成 OKF 页面草稿',
                similarity: 1,
                citations: [`asset://${id}/${source.path}`],
                proposedContent: [
                    '---',
                    'type: Draft',
                    `title: ${JSON.stringify(title)}`,
                    `description: ${JSON.stringify(summary)}`,
                    `resource: ${JSON.stringify(`asset://${id}/${source.path}`)}`,
                    'tags: [generated, review-required]',
                    '---',
                    '',
                    '# Summary',
                    '',
                    summary,
                    '',
                    '# Source excerpt',
                    '',
                    excerpt.slice(0, 2_000),
                    '',
                ].join('\n'),
                createdAt: previous?.createdAt ?? now,
            });
        }

        for (const link of suggestions.filter(item => item.kind === 'link' && item.similarity >= 0.55).slice(0, 10)) {
            const targetPath = `wiki/drafts/merge-${link.id.slice(0, 10)}.md`;
            const suggestionId = createHash('sha1').update(`merge:${link.id}`).digest('hex');
            const previous = this.refreshableSuggestion(existing.get(suggestionId));
            suggestions.push({
                ...previous,
                id: suggestionId,
                kind: 'merge',
                status: previous?.status ?? 'pending',
                sourcePath: link.sourcePath,
                targetPath,
                targetTitle: `Merge review: ${link.targetTitle}`,
                reason: `两个概念语义相似度 ${(link.similarity * 100).toFixed(0)}%，生成合并审阅草稿`,
                similarity: link.similarity,
                citations: [link.sourcePath, link.targetPath],
                proposedContent: [
                    '---',
                    'type: Draft',
                    `title: ${JSON.stringify(`Merge review: ${link.targetTitle}`)}`,
                    'tags: [merge-proposal, review-required]',
                    '---',
                    '',
                    '# Candidate concepts',
                    '',
                    `- [${this.content.titleFromPath(link.sourcePath)}](/${link.sourcePath.replace(/^wiki\//, '')})`,
                    `- [${link.targetTitle}](/${link.targetPath.replace(/^wiki\//, '')})`,
                    '',
                    '# Review',
                    '',
                    'Compare the cited concepts before consolidating them. Accepting this proposal creates only this draft and never deletes either source page.',
                    '',
                ].join('\n'),
                createdAt: previous?.createdAt ?? now,
            });
        }

        for (const previous of existing.values()) {
            if (
                previous.status !== 'pending' &&
                previous.status !== 'reverted' &&
                !suggestions.some(item => item.id === previous.id)
            ) {
                suggestions.push(previous);
            }
        }
        const knowledge = { ...this.content.knowledgeMetadata(asset), lastCurationAt: now };
        const retainedSuggestions = suggestions.slice(0, 100);
        await this.assets.updateAsset(id, {
            metadata: { knowledgeCurationSuggestions: retainedSuggestions, knowledge },
        });
        return {
            assetId: id,
            pendingCount: retainedSuggestions.filter(item => item.status === 'pending').length,
            suggestions: retainedSuggestions,
        };
    }

    private async reviewUnlocked(
        id: string,
        suggestionId: string,
        actorId: string,
        decision: KnowledgeCurationDecision,
    ) {
        if (decision !== 'accept' && decision !== 'reject' && decision !== 'revert') {
            throw new BadRequestException('审核操作必须是接受、拒绝或撤销');
        }
        const asset = await this.content.requireAsset(id);
        const suggestions = this.suggestions(asset);
        const suggestion = suggestions.find(item => item.id === suggestionId);
        if (!suggestion) throw new NotFoundException('策展建议不存在');

        if (decision === 'revert') {
            if (suggestion.status !== 'accepted') throw new BadRequestException('只能撤销已接受的策展建议');
            if (suggestion.appliedMode === 'create') {
                if (suggestion.applicationState !== 'reverting') {
                    suggestion.applicationState = 'reverting';
                    await this.persistSuggestions(id, suggestions);
                }
                const pageContent = await this.assets.getBlobContent(id, suggestion.targetPath).catch(() => null);
                if (pageContent !== null) {
                    const currentSha = createHash('sha1').update(pageContent).digest('hex');
                    if (suggestion.appliedContentSha !== currentSha) {
                        throw new ConflictException('页面在接受建议后已发生变化，请先撤销依赖该页面的后续建议或检查差异');
                    }
                    const reverted = await this.assets.deleteBlob(
                        id,
                        suggestion.targetPath,
                        `Revert knowledge suggestion ${suggestion.id}`,
                        'main',
                    );
                    suggestion.commitSha = reverted.commitSha;
                }
            } else if (suggestion.appliedText) {
                const pageContent = await this.assets.getBlobContent(id, suggestion.sourcePath);
                const currentSha = createHash('sha1').update(pageContent).digest('hex');
                if (suggestion.applicationState !== 'reverting') {
                    if (suggestion.appliedContentSha && suggestion.appliedContentSha !== currentSha) {
                        throw new ConflictException('页面在接受建议后已发生变化，撤销会覆盖后续编辑，请先检查页面差异');
                    }
                    const firstMatch = pageContent.indexOf(suggestion.appliedText);
                    const secondMatch = firstMatch < 0
                        ? -1
                        : pageContent.indexOf(suggestion.appliedText, firstMatch + suggestion.appliedText.length);
                    if (firstMatch < 0 || secondMatch >= 0) {
                        throw new ConflictException('无法唯一定位该建议添加的内容，请检查页面差异后再撤销');
                    }
                    suggestion.revertedContentSha = createHash('sha1')
                        .update(`${pageContent.slice(0, firstMatch)}${pageContent.slice(firstMatch + suggestion.appliedText.length)}`)
                        .digest('hex');
                    suggestion.applicationState = 'reverting';
                    await this.persistSuggestions(id, suggestions);
                }
                if (currentSha === suggestion.appliedContentSha) {
                    const firstMatch = pageContent.indexOf(suggestion.appliedText);
                    const reverted = await this.assets.updateBlob(
                        id,
                        suggestion.sourcePath,
                        `${pageContent.slice(0, firstMatch)}${pageContent.slice(firstMatch + suggestion.appliedText.length)}`,
                        `Revert knowledge suggestion ${suggestion.id}`,
                        'main',
                    );
                    suggestion.commitSha = reverted.commitSha;
                } else if (currentSha !== suggestion.revertedContentSha) {
                    throw new ConflictException('页面在撤销策展建议时已发生变化，请检查差异后重试');
                }
            }
            delete suggestion.applicationState;
            delete suggestion.revertedContentSha;
            suggestion.status = 'reverted';
            suggestion.reviewedAt = new Date().toISOString();
            suggestion.reviewedBy = actorId;
            await this.assets.updateAsset(id, { metadata: { knowledgeCurationSuggestions: suggestions } });
            await this.audit.append(id, {
                action: 'curation.reverted',
                target: suggestion.targetPath,
                fromTarget: suggestion.sourcePath,
                actorId,
                commitSha: suggestion.commitSha,
                metadata: { suggestionId: suggestion.id },
            });
            return suggestion;
        }

        if (suggestion.status !== 'pending') throw new BadRequestException('该策展建议已审核');

        if (decision === 'accept') {
            if (suggestion.kind === 'link' || suggestion.kind === 'summary') {
                const pageContent = await this.assets.getBlobContent(id, suggestion.sourcePath);
                const target = `/${suggestion.targetPath.replace(/^wiki\//, '')}`;
                if (suggestion.applicationState !== 'applying') {
                    const appliedText = suggestion.kind === 'link'
                        ? pageContent.includes(`](${target})`)
                            ? ''
                            : `\n\n## Related\n\n- [${suggestion.targetTitle}](${target})\n`
                        : suggestion.proposedContent || '';
                    if (appliedText) {
                        suggestion.appliedText = appliedText;
                        suggestion.appliedMode = 'append';
                        suggestion.originalContentSha = createHash('sha1').update(pageContent).digest('hex');
                        suggestion.appliedContentSha = createHash('sha1').update(`${pageContent}${appliedText}`).digest('hex');
                        suggestion.applicationState = 'applying';
                        await this.persistSuggestions(id, suggestions);
                    }
                }
                if (suggestion.applicationState === 'applying' && suggestion.appliedText) {
                    const currentContent = await this.assets.getBlobContent(id, suggestion.sourcePath);
                    const currentSha = createHash('sha1').update(currentContent).digest('hex');
                    if (currentSha === suggestion.originalContentSha) {
                        const result = await this.assets.updateBlob(
                            id,
                            suggestion.sourcePath,
                            `${currentContent}${suggestion.appliedText}`,
                            `Accept knowledge link suggestion ${suggestion.id}`,
                            'main',
                        );
                        suggestion.commitSha = result.commitSha;
                    } else if (currentSha !== suggestion.appliedContentSha) {
                        throw new ConflictException('页面在应用策展建议时已发生变化，请检查差异后重试');
                    }
                }
            } else {
                if (!suggestion.proposedContent) throw new BadRequestException('策展建议没有可应用的内容');
                if (suggestion.applicationState !== 'applying') {
                    const existingContent = await this.assets.getBlobContent(id, suggestion.targetPath).catch(() => null);
                    if (existingContent !== null) throw new ConflictException('策展建议的目标页面已存在');
                    suggestion.appliedMode = 'create';
                    suggestion.appliedContentSha = createHash('sha1').update(suggestion.proposedContent).digest('hex');
                    suggestion.applicationState = 'applying';
                    await this.persistSuggestions(id, suggestions);
                }
                const existingContent = await this.assets.getBlobContent(id, suggestion.targetPath).catch(() => null);
                if (existingContent === null) {
                    const result = await this.assets.updateBlob(
                        id,
                        suggestion.targetPath,
                        suggestion.proposedContent,
                        `Accept knowledge ${suggestion.kind} proposal ${suggestion.id}`,
                        'main',
                    );
                    suggestion.commitSha = result.commitSha;
                } else if (createHash('sha1').update(existingContent).digest('hex') !== suggestion.appliedContentSha) {
                    throw new ConflictException('策展建议的目标页面已存在且内容不同');
                }
            }
            delete suggestion.applicationState;
            delete suggestion.originalContentSha;
        }
        suggestion.status = decision === 'accept' ? 'accepted' : 'rejected';
        suggestion.reviewedAt = new Date().toISOString();
        suggestion.reviewedBy = actorId;
        const legacyAudit = [
            {
                id: createHash('sha1').update(`${suggestion.id}:${suggestion.reviewedAt}`).digest('hex'),
                action: `curation.${suggestion.status}`,
                target: suggestion.targetPath,
                fromTarget: suggestion.sourcePath,
                actorId,
                at: suggestion.reviewedAt,
            },
            ...this.legacyAudit(asset),
        ].slice(0, 200);
        await this.assets.updateAsset(id, {
            metadata: {
                knowledgeCurationSuggestions: suggestions,
                knowledgeCurationAudit: legacyAudit,
            },
        });
        await this.audit.append(id, {
            action: `curation.${suggestion.status}`,
            target: suggestion.targetPath,
            fromTarget: suggestion.sourcePath,
            actorId,
            commitSha: suggestion.commitSha,
            metadata: { suggestionId: suggestion.id },
        });
        return suggestion;
    }

    private suggestions(asset: Awaited<ReturnType<KnowledgeContentService['requireAsset']>>): KnowledgeCurationSuggestion[] {
        const suggestions = asset.metadata?.knowledgeCurationSuggestions;
        return Array.isArray(suggestions)
            ? suggestions.filter(
                  (item): item is KnowledgeCurationSuggestion =>
                      Boolean(item) && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string',
              )
            : [];
    }

    private persistSuggestions(id: string, suggestions: KnowledgeCurationSuggestion[]): Promise<unknown> {
        return this.assets.updateAsset(id, { metadata: { knowledgeCurationSuggestions: suggestions } });
    }

    private legacyAudit(
        asset: Awaited<ReturnType<KnowledgeContentService['requireAsset']>>,
    ): Array<Record<string, unknown>> {
        const audit = asset.metadata?.knowledgeCurationAudit;
        return Array.isArray(audit) ? (audit as Array<Record<string, unknown>>) : [];
    }

    private refreshableSuggestion(
        previous: KnowledgeCurationSuggestion | undefined,
    ): KnowledgeCurationSuggestion | undefined {
        if (!previous || previous.status !== 'reverted') return previous;
        const {
            appliedText: _appliedText,
            appliedContentSha: _appliedContentSha,
            appliedMode: _appliedMode,
            applicationState: _applicationState,
            originalContentSha: _originalContentSha,
            revertedContentSha: _revertedContentSha,
            commitSha: _commitSha,
            reviewedAt: _reviewedAt,
            reviewedBy: _reviewedBy,
            ...rest
        } = previous;
        return { ...rest, status: 'pending' };
    }

    private isManagedPage(page: KnowledgePageEntry): boolean {
        const normalizedPath = page.path.toLowerCase();
        if (normalizedPath.startsWith('wiki/generated/') || normalizedPath.startsWith('wiki/drafts/')) return true;
        const tags = new Set(page.tags.map(tag => tag.toLowerCase()));
        return tags.has('generated') || tags.has('review-required') || tags.has('merge-proposal');
    }

    private runSerially<T>(assetId: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.queues.get(assetId) ?? Promise.resolve();
        const result = previous.catch(() => undefined).then(operation);
        const settled = result.then(
            () => undefined,
            () => undefined,
        );
        this.queues.set(assetId, settled);
        return result.finally(() => {
            if (this.queues.get(assetId) === settled) this.queues.delete(assetId);
        });
    }

    private stringMetadataValue(value: unknown): string {
        return typeof value === 'string' ? value : '';
    }

    private slugFromSource(path: string): string {
        const stem = (path.split('/').pop() || path).replace(/\.[^.]+$/, '');
        const slug = stem
            .normalize('NFKD')
            .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
            .replace(/^-+|-+$/g, '')
            .toLowerCase();
        return slug || createHash('sha1').update(path).digest('hex').slice(0, 12);
    }

    private extractiveSummary(value: string): string {
        const compact = value.replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();
        if (compact.length < 40) return '';
        const sentences = compact.split(/(?<=[。！？.!?])\s+/).filter(Boolean);
        return (sentences.slice(0, 3).join(' ') || compact).slice(0, 420);
    }
}
