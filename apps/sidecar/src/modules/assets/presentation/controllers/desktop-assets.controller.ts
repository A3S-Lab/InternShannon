import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DesktopOwnerId } from '@/shared/security/decorators/desktop-owner.decorator';
import { DesktopApi } from '@/shared/security/desktop-access';
import { BadRequestException, NotFoundException } from '@/shared/common/errors';
import { ApiCreatedResponse, ApiOkResponse } from '@/shared/api/openapi';
import { ASSET_SERVICE, type IAssetService } from '@/modules/assets/domain/services/asset.service.interface';
import type { Asset } from '@/modules/assets/domain/entities/asset.entity';
import type { Blob } from '@/modules/assets/domain/entities/blob.entity';

type RepositoryTreeItem = {
    path: string;
    name: string;
    type: 'tree' | 'blob' | 'commit';
    mode: string;
    sha: string;
    size: number | null;
};

type WikiPageType = 'entity' | 'concept' | 'source' | 'query' | 'synthesis' | 'comparison';

interface UpdateBlobBody {
    content?: string;
    message?: string;
    branch?: string;
    authorName?: string;
    authorEmail?: string;
}

interface DeleteBlobBody {
    message?: string;
    branch?: string;
    authorName?: string;
    authorEmail?: string;
}

interface RenameBlobBody extends DeleteBlobBody {
    toPath?: string;
}

interface UploadSourcesBody {
    sources?: Array<{ name?: string; contentBase64?: string }>;
    ingest?: boolean;
}

@DesktopApi()
@Controller('assets')
export class DesktopAssetsController {
    constructor(@Inject(ASSET_SERVICE) private readonly assets: IAssetService) {}

    @Get('me/knowledge')
    @ApiOkResponse({ summary: '获取我的个人知识库资产' })
    async getMyKnowledge(@DesktopOwnerId() userId: string) {
        return this.assetDto(await this.assets.getOrCreatePersonalKnowledge(userId));
    }

    @Get(':id/repository')
    @ApiOkResponse({ summary: '获取资产仓库信息' })
    async repository(@Param('id') id: string) {
        const asset = await this.requireAsset(id);
        return {
            assetId: asset.id,
            cloneUrl: asset.cloneUrl,
            defaultBranch: asset.defaultBranch || 'main',
            refs: this.repositoryRefs(asset),
        };
    }

    @Get(':id/repository/tree')
    @ApiOkResponse({ summary: '列出资产仓库目录树' })
    async repositoryTree(
        @Param('id') id: string,
        @Query('ref') ref?: string,
        @Query('path') treePath?: string,
        @Query('page') pageValue?: string,
        @Query('limit') limitValue?: string,
    ) {
        const asset = await this.requireAsset(id);
        const normalizedPath = this.normalizeBlobPath(treePath);
        const allItems = this.treeItems(asset, normalizedPath);
        const page = Math.max(1, Number(pageValue) || 1);
        const limit = Math.max(1, Math.min(1000, Number(limitValue) || 1000));
        const offset = (page - 1) * limit;
        const items = allItems.slice(offset, offset + limit);
        const totalPages = Math.max(1, Math.ceil(allItems.length / limit));

        return {
            assetId: asset.id,
            ref: ref?.trim() || asset.defaultBranch || 'main',
            path: normalizedPath,
            items,
            total: allItems.length,
            page,
            limit,
            totalPages,
            hasNext: page < totalPages,
            hasPrevious: page > 1,
        };
    }

    @Get(':id/repository/blob')
    @ApiOkResponse({ summary: '读取资产仓库文件内容' })
    async repositoryBlob(@Param('id') id: string, @Query('path') path: string, @Query('ref') ref?: string) {
        const asset = await this.requireAsset(id);
        const normalizedPath = this.requireBlobPath(path);
        const content = await this.assets.getBlobContent(asset.id, normalizedPath);
        return {
            assetId: asset.id,
            ref: ref?.trim() || asset.defaultBranch || 'main',
            path: normalizedPath,
            encoding: 'utf8' as const,
            content,
            size: Buffer.byteLength(content, 'utf8'),
        };
    }

    @Post(':id/blobs/update')
    @ApiCreatedResponse({ summary: '更新资产仓库文件' })
    async updateBlob(@Param('id') id: string, @Query('path') path: string, @Body() body: UpdateBlobBody) {
        const normalizedPath = this.requireBlobPath(path);
        return this.assets.updateBlob(
            id,
            normalizedPath,
            typeof body.content === 'string' ? body.content : '',
            body.message || `Update ${normalizedPath}`,
            body.branch || 'main',
            body.authorName,
            body.authorEmail,
        );
    }

    @Post(':id/blobs/delete')
    @ApiCreatedResponse({ summary: '删除资产仓库文件' })
    async deleteBlob(@Param('id') id: string, @Query('path') path: string, @Body() body: DeleteBlobBody) {
        const normalizedPath = this.requireBlobPath(path);
        return this.assets.deleteBlob(
            id,
            normalizedPath,
            body.message || `Delete ${normalizedPath}`,
            body.branch || 'main',
            body.authorName,
            body.authorEmail,
        );
    }

    @Post(':id/blobs/rename')
    @ApiCreatedResponse({ summary: '重命名资产仓库文件' })
    async renameBlob(@Param('id') id: string, @Query('path') path: string, @Body() body: RenameBlobBody) {
        const normalizedPath = this.requireBlobPath(path);
        const toPath = this.requireBlobPath(body.toPath);
        return this.assets.renameBlob(
            id,
            normalizedPath,
            toPath,
            body.message || `Rename ${normalizedPath} to ${toPath}`,
            body.branch || 'main',
            body.authorName,
            body.authorEmail,
        );
    }

    @Get(':id/wiki/sources')
    @ApiOkResponse({ summary: '列出资产 Wiki 来源' })
    async listWikiSources(@Param('id') id: string) {
        const asset = await this.requireAsset(id);
        return this.sourceEntries(asset);
    }

    @Post(':id/wiki/sources')
    @ApiCreatedResponse({ summary: '上传资产 Wiki 来源' })
    async uploadWikiSources(@Param('id') id: string, @Body() body: UploadSourcesBody) {
        const sources = Array.isArray(body.sources) ? body.sources : [];
        if (sources.length === 0) {
            throw new BadRequestException('sources is required');
        }
        const paths: string[] = [];
        for (const source of sources) {
            const name = this.safeSourceName(source.name);
            const contentBase64 = source.contentBase64 || '';
            const buffer = Buffer.from(contentBase64, 'base64');
            const path = `raw/sources/${name}`;
            await this.assets.updateBlob(id, path, buffer.toString('utf8'), `Import ${name}`, 'main');
            paths.push(path);
        }
        return { paths };
    }

    @Delete(':id/wiki/sources')
    @ApiOkResponse({ summary: '删除资产 Wiki 来源' })
    async deleteWikiSource(@Param('id') id: string, @Query('path') path: string) {
        const normalizedPath = this.requireBlobPath(path);
        const result = await this.assets.deleteBlob(id, normalizedPath, `Delete ${normalizedPath}`, 'main');
        return { deleted: result.deleted, path: normalizedPath };
    }

    @Get(':id/wiki/pages')
    @ApiOkResponse({ summary: '列出资产 Wiki 页面' })
    async listWikiPages(@Param('id') id: string) {
        const asset = await this.requireAsset(id);
        return this.pageEntries(asset);
    }

    @Get(':id/wiki/graph')
    @ApiOkResponse({ summary: '获取资产 Wiki 图谱' })
    async wikiGraph(@Param('id') id: string) {
        const asset = await this.requireAsset(id);
        const pages = this.pageEntries(asset);
        const contents = this.blobContents(asset);
        const byAlias = new Map<string, string>();
        for (const page of pages) {
            byAlias.set(page.title.toLowerCase(), page.path);
            byAlias.set(this.titleFromPath(page.path).toLowerCase(), page.path);
            byAlias.set(page.path.toLowerCase(), page.path);
        }

        const edgeWeights = new Map<string, { source: string; target: string; weight: number }>();
        for (const page of pages) {
            const content = contents[page.path] ?? '';
            for (const targetAlias of this.wikilinks(content)) {
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
        const edges = Array.from(edgeWeights.values()).map(edge => {
            degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
            degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
            return {
                ...edge,
                signals: {
                    directLink: edge.weight,
                    sourceOverlap: 0,
                    adamicAdar: 0,
                    typeAffinity: 0,
                },
            };
        });

        return {
            nodes: pages.map(page => ({
                path: page.path,
                title: page.title,
                type: page.type,
                sourceCount: page.sources.length,
                degree: degree.get(page.path) ?? 0,
            })),
            edges,
        };
    }

    @Patch(':id/wiki/pages')
    @ApiOkResponse({ summary: '保存资产 Wiki 页面' })
    async saveWikiPage(@Param('id') id: string, @Body() body: { path?: string; content?: string }) {
        const path = this.requireBlobPath(body.path);
        await this.assets.updateBlob(id, path, body.content ?? '', `Update ${path}`, 'main');
        return { saved: true, path };
    }

    @Delete(':id/wiki/pages')
    @ApiOkResponse({ summary: '删除资产 Wiki 页面' })
    async deleteWikiPage(@Param('id') id: string, @Query('path') path: string) {
        const normalizedPath = this.requireBlobPath(path);
        const result = await this.assets.deleteBlob(id, normalizedPath, `Delete ${normalizedPath}`, 'main');
        return { deleted: result.deleted, path: normalizedPath };
    }

    @Post(':id/wiki/pages/rename')
    @ApiCreatedResponse({ summary: '重命名资产 Wiki 页面' })
    async renameWikiPage(@Param('id') id: string, @Body() body: { fromPath?: string; toPath?: string }) {
        const fromPath = this.requireBlobPath(body.fromPath);
        const toPath = this.requireBlobPath(body.toPath);
        await this.assets.renameBlob(id, fromPath, toPath, `Rename ${fromPath} to ${toPath}`, 'main');
        return { renamed: true, fromPath, toPath };
    }

    @Get(':id/wiki/health')
    @ApiOkResponse({ summary: '获取资产 Wiki 健康状态' })
    async wikiHealth(@Param('id') id: string) {
        const asset = await this.requireAsset(id);
        const pages = this.pageEntries(asset);
        const sources = this.sourceEntries(asset);
        return {
            pageCount: pages.length,
            sourceCount: sources.length,
            ingestedSourceCount: sources.length,
            lastIngestedAt: this.latestContentUpdatedAt(asset),
            taggedPageCount: pages.filter(page => page.tags.length > 0).length,
            brokenLinks: [],
            orphanPages: pages
                .filter(page => page.path !== 'wiki/index.md')
                .map(page => ({
                    path: page.path,
                    title: page.title,
                    type: page.type,
                })),
        };
    }

    @Post(':id/wiki/reindex')
    @ApiCreatedResponse({ summary: '重建资产 Wiki 索引' })
    async wikiReindex(@Param('id') id: string) {
        const asset = await this.requireAsset(id);
        return {
            nodeCount: this.pageEntries(asset).length,
            linkCount: 0,
        };
    }

    private async requireAsset(id: string): Promise<Asset> {
        const asset = await this.assets.getAsset(id);
        if (!asset) {
            throw new NotFoundException('Asset not found');
        }
        return asset;
    }

    private assetDto(asset: Asset) {
        return asset.toProps();
    }

    private repositoryRefs(asset: Asset) {
        const branch = asset.defaultBranch || 'main';
        const head = asset.branches.find(item => item.name === branch)?.commitSha || asset.commits[0]?.sha || 'HEAD';
        return [{ name: branch, type: 'branch' as const, sha: head }];
    }

    private treeItems(asset: Asset, dirPath: string): RepositoryTreeItem[] {
        const normalizedDir = this.normalizeBlobPath(dirPath);
        const prefix = normalizedDir ? `${normalizedDir}/` : '';
        const directories = new Map<string, RepositoryTreeItem>();
        const files = new Map<string, RepositoryTreeItem>();

        for (const blob of this.contentBlobs(asset)) {
            if (prefix && !blob.path.startsWith(prefix)) continue;
            const rest = prefix ? blob.path.slice(prefix.length) : blob.path;
            if (!rest || rest.startsWith('/')) continue;
            const [head] = rest.split('/');
            if (!head) continue;
            const childPath = prefix ? `${prefix}${head}` : head;
            if (rest.includes('/')) {
                directories.set(childPath, {
                    path: childPath,
                    name: head,
                    type: 'tree',
                    mode: '040000',
                    sha: this.shaForText(`tree:${childPath}`),
                    size: null,
                });
            } else {
                files.set(childPath, {
                    path: childPath,
                    name: head,
                    type: 'blob',
                    mode: '100644',
                    sha: blob.contentSha || blob.id || this.shaForText(blob.path),
                    size: typeof blob.size === 'number' ? blob.size : null,
                });
            }
        }

        return [...directories.values(), ...files.values()].sort((left, right) => {
            if (left.type !== right.type) return left.type === 'tree' ? -1 : 1;
            return left.name.localeCompare(right.name, 'zh-CN');
        });
    }

    private contentBlobs(asset: Asset): Array<Pick<Blob, 'id' | 'path' | 'size' | 'contentSha' | 'isBinary'>> {
        const contents = this.blobContents(asset);
        const byPath = new Map<string, Pick<Blob, 'id' | 'path' | 'size' | 'contentSha' | 'isBinary'>>();
        for (const blob of asset.blobs ?? []) {
            byPath.set(blob.path, blob);
        }
        for (const [path, content] of Object.entries(contents)) {
            const previous = byPath.get(path);
            byPath.set(path, {
                id: previous?.id || this.shaForText(content),
                path,
                size: previous?.size ?? Buffer.byteLength(content, 'utf8'),
                contentSha: previous?.contentSha || this.shaForText(content),
                isBinary: previous?.isBinary ?? false,
            });
        }
        return Array.from(byPath.values());
    }

    private blobContents(asset: Asset): Record<string, string> {
        const contents = asset.metadata?.blobContents;
        return contents && typeof contents === 'object' && !Array.isArray(contents)
            ? (contents as Record<string, string>)
            : {};
    }

    private pageEntries(asset: Asset) {
        const contents = this.blobContents(asset);
        return Object.entries(contents)
            .filter(([path]) => path.startsWith('wiki/') && path.toLowerCase().endsWith('.md'))
            .map(([path, content]) => {
                const frontmatter = this.readFrontmatter(content);
                return {
                    path,
                    title: frontmatter.title || this.titleFromPath(path),
                    type: this.wikiPageType(frontmatter.type),
                    sources: [],
                    tags: frontmatter.tags ?? [],
                };
            })
            .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));
    }

    private sourceEntries(asset: Asset) {
        const contents = this.blobContents(asset);
        return Object.entries(contents)
            .filter(([path]) => path.startsWith('raw/sources/'))
            .map(([path, content]) => ({
                path,
                name: path.split('/').pop() || path,
                size: Buffer.byteLength(content, 'utf8'),
            }))
            .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
    }

    private readFrontmatter(content: string): { title?: string; type?: string; tags?: string[] } {
        const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
        if (!match) return {};
        const result: { title?: string; type?: string; tags?: string[] } = {};
        for (const line of match[1].split(/\r?\n/)) {
            const separator = line.indexOf(':');
            if (separator <= 0) continue;
            const key = line.slice(0, separator).trim();
            const value = line.slice(separator + 1).trim();
            if (key === 'title') result.title = value.replace(/^['"]|['"]$/g, '');
            if (key === 'type') result.type = value.replace(/^['"]|['"]$/g, '');
            if (key === 'tags') {
                result.tags = value
                    .replace(/^\[|\]$/g, '')
                    .split(',')
                    .map(item => item.trim().replace(/^['"]|['"]$/g, ''))
                    .filter(Boolean);
            }
        }
        return result;
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

    private wikiPageType(value?: string): WikiPageType | null {
        return value === 'entity' ||
            value === 'concept' ||
            value === 'source' ||
            value === 'query' ||
            value === 'synthesis' ||
            value === 'comparison'
            ? value
            : null;
    }

    private titleFromPath(path: string): string {
        const name = path.split('/').pop() || path;
        return name.replace(/\.[^.]+$/, '') || name;
    }

    private latestContentUpdatedAt(asset: Asset): string | null {
        const times = [asset.updatedAt, ...asset.commits.map(commit => commit.createdAt)]
            .map(value => new Date(value).getTime())
            .filter(Number.isFinite);
        if (times.length === 0) return null;
        return new Date(Math.max(...times)).toISOString();
    }

    private requireBlobPath(value: string | undefined): string {
        const normalized = this.normalizeBlobPath(value);
        if (!normalized) {
            throw new BadRequestException('path is required');
        }
        return normalized;
    }

    private normalizeBlobPath(value: string | undefined): string {
        return (value ?? '')
            .replace(/\\/g, '/')
            .split('/')
            .map(segment => segment.trim())
            .filter(segment => segment && segment !== '.' && segment !== '..')
            .join('/');
    }

    private safeSourceName(value: string | undefined): string {
        const name = (value ?? '').replace(/\\/g, '/').split('/').pop()?.trim();
        if (!name || name === '.' || name === '..') {
            throw new BadRequestException('source name is required');
        }
        return name.replace(/[<>:"|?*\x00-\x1F]/g, '-');
    }

    private shaForText(value: string): string {
        return createHash('sha1').update(value).digest('hex');
    }
}
