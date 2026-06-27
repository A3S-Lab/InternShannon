import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import { desktopJsonFilePath } from '../desktop-paths';
import {
    matchesAssetCatalogProfile,
    readAssetCatalogProfile,
} from '../../../modules/assets/application/asset-catalog-profile';
import { Asset } from '../../../modules/assets/domain/entities/asset.entity';
import {
    AssetCatalogFilters,
    IAssetRepository,
} from '../../../modules/assets/domain/repositories/asset.repository.interface';
import {
    AgentKind,
    AssetCategory,
    Visibility,
    isAgentKind,
    resolveGlobalKnowledgeDomain,
} from '../../../modules/assets/domain/value-objects';
import { PageQueryOptions, PageResult } from '../../../shared/application/pagination.dto';

@Injectable()
export class DesktopAssetRepository implements IAssetRepository {
    private readonly logger = new Logger(DesktopAssetRepository.name);
    private readonly assetsPath: string;
    private assetsCache: Map<string, Asset> = new Map();
    private loaded = false;

    constructor() {
        this.assetsPath = desktopJsonFilePath('assets.json', this.logger);
    }

    private async loadAssets(): Promise<Map<string, Asset>> {
        if (this.loaded) {
            return this.assetsCache;
        }

        try {
            if (fs.existsSync(this.assetsPath)) {
                const content = fs.readFileSync(this.assetsPath, 'utf-8');
                const data = JSON.parse(content) as unknown[];
                this.assetsCache = new Map(data.map(row => {
                    const asset = this.mapRowToAsset(row);
                    return [asset.id, asset];
                }));
                this.logger.debug(`Loaded ${this.assetsCache.size} assets from file`);
            }
        } catch (e) {
            this.logger.warn(`Failed to load assets: ${e}`);
            this.assetsCache = new Map();
        }

        this.loaded = true;
        return this.assetsCache;
    }

    private async saveAssets(): Promise<void> {
        try {
            const data = Array.from(this.assetsCache.values()).map(asset => asset.toProps());
            fs.writeFileSync(this.assetsPath, JSON.stringify(data, null, 2), 'utf-8');
            this.logger.debug(`Saved ${data.length} assets to file`);
        } catch (e) {
            this.logger.error(`Failed to save assets: ${e}`);
            throw e;
        }
    }

    private mapRowToAsset(row: any): Asset {
        const rawAgentKind = row.agentKind ?? row._agentKind;
        return Asset.createFromRow({
            id: row.id ?? row._id,
            name: row.name ?? row._name,
            ownerId: row.ownerId ?? row._ownerId,
            ownerType: row.ownerType ?? row._ownerType,
            category: (row.category ?? row._category) as AssetCategory,
            visibility: (row.visibility ?? row._visibility ?? 'private') as Visibility,
            description: row.description ?? row._description ?? undefined,
            homepage: row.homepage ?? row._homepage ?? undefined,
            defaultBranch: row.defaultBranch ?? row._defaultBranch ?? 'main',
            cloneUrl: row.cloneUrl ?? row._cloneUrl ?? '',
            starCount: row.starCount ?? row._starCount ?? 0,
            forkCount: row.forkCount ?? row._forkCount ?? 0,
            watchCount: row.watchCount ?? row._watchCount ?? 0,
            isForked: row.isForked ?? row._isForked ?? false,
            sourceAssetId: row.sourceAssetId ?? row._sourceAssetId ?? undefined,
            createdAt: row.createdAt ?? row._createdAt ?? new Date(),
            updatedAt: row.updatedAt ?? row._updatedAt ?? new Date(),
            content: row.content ?? row._content ?? undefined,
            metadata: row.metadata ?? row._metadata ?? undefined,
            enabled: row.enabled ?? row._enabled ?? true,
            agentKind: isAgentKind(rawAgentKind) ? (rawAgentKind as AgentKind) : undefined,
        });
    }

    async findById(id: string): Promise<Asset | null> {
        const assets = await this.loadAssets();
        return assets.get(id) || null;
    }

    async findCoreById(id: string): Promise<Asset | null> {
        // The blobContents bloat comes from cloud modelscope-sync; desktop reads
        // a small local .safeclaw/assets.json fully into memory, so there is no
        // detoast/transfer to save here. Delegate to findById — the returned
        // asset is a superset, and the detail/permission path ignores blobContents.
        return this.findById(id);
    }

    async findByIds(ids: string[]): Promise<Asset[]> {
        const unique = [...new Set(ids.filter(Boolean))];
        if (unique.length === 0) return [];
        const assets = await this.loadAssets();
        return unique.map(id => assets.get(id)).filter((a): a is Asset => Boolean(a));
    }

    async findByMetadataChildId(key: string, childId: string): Promise<Asset | null> {
        // 桌面端读 .safeclaw/assets.json，保留旧 service 层的内存扫描语义（逐字节一致）。
        const assets = await this.loadAssets();
        for (const asset of assets.values()) {
            const value = asset.metadata?.[key];
            if (
                Array.isArray(value) &&
                value.some(
                    item => item !== null && typeof item === "object" && (item as { id?: unknown }).id === childId
                )
            ) {
                return asset;
            }
        }
        return null;
    }

    async findAll(): Promise<Asset[]> {
        const assets = await this.loadAssets();
        return Array.from(assets.values()).sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
    }

    async save(asset: Asset): Promise<void> {
        const assets = await this.loadAssets();
        assets.set(asset.id, asset);
        await this.saveAssets();
    }

    async delete(id: string): Promise<void> {
        const assets = await this.loadAssets();
        assets.delete(id);
        await this.saveAssets();
    }

    async findByOwnerId(ownerId: string, _ownerType: 'user' | 'organization'): Promise<Asset[]> {
        const assets = await this.loadAssets();
        return Array.from(assets.values())
            .filter(a => a.ownerId === ownerId)
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }

    async findPaginated(options: PageQueryOptions & {
        ownerId?: string;
        ownerType?: 'user' | 'organization';
        category?: AssetCategory;
        visibility?: 'public' | 'private';
        sourceAssetId?: string;
    } & AssetCatalogFilters): Promise<PageResult<Asset>> {
        const assets = await this.loadAssets();
        const keyword = options.search?.toLowerCase();
        const rows = Array.from(assets.values())
            .filter(asset => !options.ownerId || asset.ownerId === options.ownerId)
            .filter(asset => !options.ownerType || asset.ownerType === options.ownerType)
            .filter(asset => !options.category || asset.category === options.category)
            .filter(asset => !options.visibility || asset.visibility === options.visibility)
            .filter(asset => !options.sourceAssetId || asset.sourceAssetId === options.sourceAssetId)
            .filter(asset => this.matchesCatalogFilters(asset, options))
            .filter(asset => {
                if (!keyword) return true;
                return [
                    asset.name,
                    asset.description,
                    asset.ownerId,
                    asset.cloneUrl,
                    JSON.stringify(asset.metadata ?? {}),
                ].some(value => value?.toLowerCase().includes(keyword));
            })
            .sort((a, b) => this.compareAssets(a, b, options.sortBy, options.sortOrder));

        return {
            items: rows.slice(options.offset, options.offset + options.limit),
            total: rows.length,
            page: options.page,
            limit: options.limit,
        };
    }

    async findAccessiblePaginated(options: PageQueryOptions & {
        userId: string;
        organizationIds?: string[];
        ownerId?: string;
        ownerType?: 'user' | 'organization';
        category?: AssetCategory;
        visibility?: 'public' | 'private';
        sourceAssetId?: string;
    } & AssetCatalogFilters): Promise<PageResult<Asset>> {
        const organizationIds = new Set(options.organizationIds ?? []);
        const assets = await this.loadAssets();
        const keyword = options.search?.toLowerCase();
        const rows = Array.from(assets.values())
            .filter(asset => asset.visibility === 'public'
                || asset.metadata?.builtin === true
                || asset.ownerId === options.userId
                || asset.ownerType === 'organization' && organizationIds.has(asset.ownerId)
                || asset.collaborators.some(collaborator => collaborator.userId === options.userId))
            .filter(asset => !options.ownerId || asset.ownerId === options.ownerId)
            .filter(asset => !options.ownerType || asset.ownerType === options.ownerType)
            .filter(asset => !options.category || asset.category === options.category)
            .filter(asset => !options.visibility || asset.visibility === options.visibility)
            .filter(asset => !options.sourceAssetId || asset.sourceAssetId === options.sourceAssetId)
            .filter(asset => this.matchesCatalogFilters(asset, options))
            .filter(asset => {
                if (!keyword) return true;
                return [
                    asset.name,
                    asset.description,
                    asset.ownerId,
                    asset.cloneUrl,
                    JSON.stringify(asset.metadata ?? {}),
                ].some(value => value?.toLowerCase().includes(keyword));
            })
            .sort((a, b) => this.compareAssets(a, b, options.sortBy, options.sortOrder));

        return {
            items: rows.slice(options.offset, options.offset + options.limit),
            total: rows.length,
            page: options.page,
            limit: options.limit,
        };
    }

    async findPublic(limit: number, offset: number): Promise<Asset[]> {
        const assets = await this.loadAssets();
        return Array.from(assets.values())
            .filter(a => a.visibility === 'public')
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
            .slice(offset, offset + limit);
    }

    async findStarredByUserId(_userId: string): Promise<Asset[]> {
        // TODO: Implement star tracking when Star entity is available
        return [];
    }

    async findWatchedByUserId(_userId: string): Promise<Asset[]> {
        // TODO: Implement watch tracking when Watch entity is available
        return [];
    }

    async findForkedFrom(sourceAssetId: string): Promise<Asset[]> {
        const assets = await this.loadAssets();
        return Array.from(assets.values()).filter(a => a.sourceAssetId === sourceAssetId);
    }

    async findByName(ownerId: string, name: string): Promise<Asset | null> {
        const assets = await this.loadAssets();
        return Array.from(assets.values()).find(a => a.ownerId === ownerId && a.name === name) || null;
    }

    async findByOwnerAndName(owner: string, name: string): Promise<Asset | null> {
        const assets = await this.loadAssets();
        return Array.from(assets.values()).find(a => a.ownerId === owner && a.name === name) || null;
    }

    async findByCategory(category: AssetCategory): Promise<Asset[]> {
        const assets = await this.loadAssets();
        return Array.from(assets.values())
            .filter(a => a.category === category)
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }

    async findPersonalKnowledge(ownerId: string): Promise<Asset | null> {
        const assets = await this.loadAssets();
        return (
            Array.from(assets.values()).find(
                a =>
                    a.ownerId === ownerId &&
                    a.ownerType === 'user' &&
                    a.category === 'knowledge' &&
                    (a.metadata as { knowledge?: { personal?: boolean } } | undefined)?.knowledge?.personal === true,
            ) || null
        );
    }

    async findGlobalKnowledgeByDomain(domain: string): Promise<Asset | null> {
        const assets = await this.loadAssets();
        return (
            Array.from(assets.values()).find(
                a => a.ownerType === 'organization' && resolveGlobalKnowledgeDomain(a) === domain,
            ) || null
        );
    }

    async listGlobalKnowledge(): Promise<Asset[]> {
        const assets = await this.loadAssets();
        return Array.from(assets.values())
            .filter(a => a.ownerType === 'organization' && resolveGlobalKnowledgeDomain(a) !== null)
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }

    async findByCategoryAndOwner(category: AssetCategory, ownerId: string): Promise<Asset[]> {
        const assets = await this.loadAssets();
        return Array.from(assets.values())
            .filter(a => a.category === category && a.ownerId === ownerId)
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }

    async findByEnabled(enabled: boolean): Promise<Asset[]> {
        const assets = await this.loadAssets();
        return Array.from(assets.values())
            .filter(a => a.enabled === enabled)
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }

    private compareAssets(a: Asset, b: Asset, sortBy?: string, sortOrder: 'asc' | 'desc' = 'desc'): number {
        const direction = sortOrder === 'asc' ? 1 : -1;
        const getValue = (asset: Asset): string | number => {
            const profile = readAssetCatalogProfile(asset.name, asset.metadata);
            switch (sortBy) {
                case 'name':
                    return asset.name;
                case 'category':
                    return asset.category;
                case 'visibility':
                    return asset.visibility;
                case 'heat':
                    return asset.starCount + asset.forkCount;
                case 'starCount':
                    return asset.starCount;
                case 'forkCount':
                    return asset.forkCount;
                case 'watchCount':
                    return asset.watchCount;
                case 'rating':
                    return profile.rating ?? 0;
                case 'downloadCount':
                    return profile.downloadCount ?? 0;
                case 'usageCount':
                    return profile.usageCount ?? 0;
                case 'callCount':
                    return profile.metrics?.callCount ?? 0;
                case 'successRate':
                    return profile.metrics?.successRate ?? 0;
                case 'averageLatencyMs':
                    return profile.metrics?.averageLatencyMs ?? Number.MAX_SAFE_INTEGER;
                case 'createdAt':
                    return new Date(asset.createdAt).getTime();
                default:
                    return new Date(asset.updatedAt).getTime();
            }
        };

        const left = getValue(a);
        const right = getValue(b);
        if (typeof left === 'number' && typeof right === 'number') {
            return (left - right) * direction;
        }
        return String(left).localeCompare(String(right)) * direction;
    }

    private matchesCatalogFilters(asset: Asset, filters: AssetCatalogFilters): boolean {
        if (!this.matchesAgentKindFilter(asset, filters.agentKind)) return false;
        return matchesAssetCatalogProfile(readAssetCatalogProfile(asset.name, asset.metadata), filters);
    }

    private matchesAgentKindFilter(asset: Asset, value?: AssetCatalogFilters['agentKind']): boolean {
        if (!value) return true;
        if (value === 'none') return asset.category !== 'agent';
        if (asset.category !== 'agent') return false;
        if (value === 'tool') return asset.agentKind === 'tool';
        if (value === 'agentic') return asset.agentKind === 'agentic';
        // 'application': 显式 application OR 历史未声明 (null)
        return asset.agentKind === 'application' || asset.agentKind === undefined;
    }
}
