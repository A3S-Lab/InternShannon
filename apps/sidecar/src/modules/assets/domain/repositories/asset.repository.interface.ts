import { PageQueryOptions, PageResult } from '@/shared/domain/pagination';
import { Asset } from '../entities/asset.entity';
import { AgentKind } from '../value-objects/agent-kind.vo';
import { AssetCategory } from '../value-objects/asset-category.vo';

export const ASSET_REPOSITORY = Symbol('ASSET_REPOSITORY');

export interface AssetCatalogFilters {
    tags?: string[];
    level?: string;
    responseSpeed?: string;
    status?: string;
    excludeStatus?: string | string[];
    scenario?: string;
    knowledgeType?: string;
    memoryType?: string;
    qualityLevel?: string;
    qualityStatus?: string;
    riskLevel?: string;
    evolutionStatus?: string;
    evolutionTrigger?: string;
    evolutionStrategy?: string;
    provider?: string;
    indexStatus?: string;
    minRating?: number;
    modelLabel?: string;
    domainLabel?: string;
    /**
     * 智能体子类型过滤。仅当 category=agent 才有意义；'tool'/'application' 取对应类型，
     * 'none' 取非 agent 资产（用于"全部资产"列表里反向筛选）。后端把 NULL 视作隐式 'application'。
     */
    agentKind?: AgentKind | 'none';
}

export interface IAssetRepository {
    findById(id: string): Promise<Asset | null>;
    /**
     * Like {@link findById} but omits the heavy `metadata.blobContents` blob —
     * the inlined file tree that bloats some skill/mcp rows to >1 MB. Use this
     * on read paths that never touch file contents (asset detail / permission
     * checks): it avoids detoasting + transferring + JSON-parsing the blob,
     * which is the dominant cost of `GET /assets/:id`. Callers that need file
     * contents (workspace materialize, blob read, search) must use findById.
     */
    findCoreById(id: string): Promise<Asset | null>;
    findByIds(ids: string[]): Promise<Asset[]>;
    findAll(): Promise<Asset[]>;
    save(asset: Asset): Promise<void>;
    delete(id: string): Promise<void>;
    findByOwnerId(ownerId: string, ownerType: 'user' | 'organization'): Promise<Asset[]>;
    findPaginated(options: PageQueryOptions & {
        ownerId?: string;
        ownerType?: 'user' | 'organization';
        category?: AssetCategory;
        visibility?: 'public' | 'private';
        sourceAssetId?: string;
    } & AssetCatalogFilters): Promise<PageResult<Asset>>;
    findAccessiblePaginated(options: PageQueryOptions & {
        userId: string;
        organizationIds?: string[];
        ownerId?: string;
        ownerType?: 'user' | 'organization';
        category?: AssetCategory;
        visibility?: 'public' | 'private';
        sourceAssetId?: string;
        /** Desktop 兼容字段：跳过 accessFilter，可见全部资产。 */
        platformBypass?: boolean;
        /** 角色级知识库授权:额外放行的 category='knowledge' 资产 id(见实现注释)。 */
        authorizedKnowledgeBaseIds?: string[];
    } & AssetCatalogFilters): Promise<PageResult<Asset>>;
    findPublic(limit: number, offset: number): Promise<Asset[]>;
    findStarredByUserId(userId: string): Promise<Asset[]>;
    findWatchedByUserId(userId: string): Promise<Asset[]>;
    findForkedFrom(sourceAssetId: string): Promise<Asset[]>;
    findByName(ownerId: string, name: string): Promise<Asset | null>;
    findByOwnerAndName(owner: string, name: string): Promise<Asset | null>;
    findByCategory(category: AssetCategory): Promise<Asset[]>;
    /**
     * 解析某用户的专属知识库(category='knowledge' 且 metadata.knowledge.personal=true)。
     * 由迁移 093 的部分唯一索引保证至多一条。不存在时返回 null,交由应用层懒创建。
     */
    findPersonalKnowledge(ownerId: string): Promise<Asset | null>;
    /**
     * 解析某【全局知识库】域(owner_type='organization' AND category='knowledge' AND
     * metadata.knowledge.globalDomain=<domain>)。由迁移 100 的部分唯一索引保证每域至多一条。
     * 不存在时返回 null,交由应用层懒创建。
     */
    findGlobalKnowledgeByDomain(domain: string): Promise<Asset | null>;
    /**
     * 列出所有【全局知识库】(owner_type='organization' AND category='knowledge' AND
     * metadata.knowledge.globalDomain 为非空字符串)。供超管列表 / 在线管理多域知识库。
     */
    listGlobalKnowledge(): Promise<Asset[]>;
    findByCategoryAndOwner(category: AssetCategory, ownerId: string): Promise<Asset[]>;
    findByEnabled(enabled: boolean): Promise<Asset[]>;
    /**
     * 按 metadata 子集合（releases / pullRequests / issues / commitComments /
     * issueComments / pullRequestComments）中的子项 id 反查所属资产。用 jsonb `@>`
     * 包含查询命中 idx_assets_metadata_gin（jsonb_path_ops），避免全表扫描 + JS .find。
     * 子项 id 全局唯一，命中至多一行，等价于旧的 findAll().find 行为。
     * @param key metadata 数组键名，如 'releases'
     * @param childId 子项的 id
     */
    findByMetadataChildId(key: string, childId: string): Promise<Asset | null>;
}
