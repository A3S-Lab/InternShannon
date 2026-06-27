/**
 * 全局知识库(多域)的判别谓词与元数据键。
 *
 * 一条「全局知识库」资产 = 公开共享的 category='knowledge' 资产,owner_type='organization'
 * (owner='builtin-docs'),通过 `metadata.knowledge.globalDomain='<域键>'` 标记其所属域。
 * 平台文档中心是其中的 'platform-docs' 域。每个域是一个单例(迁移 100 的部分唯一索引保证)。
 *
 * 该谓词供两处「写入授权」精确放行 desktop-maintainer(platform-bypass)在线编辑全局知识库:
 * git smart-HTTP 推送(GitAccessControlService)与应用层写门(AssetAccessService),
 * 且只放行「全局知识库 × platform-bypass」这一条边,不放宽任何其它写入。
 */

/** 全局知识库的域键所在的元数据路径:metadata.knowledge.globalDomain。 */
export const GLOBAL_KNOWLEDGE_DOMAIN_METADATA_PATH = ['knowledge', 'globalDomain'] as const;

/** 平台文档中心(原单例全局文档知识库)所属的规范域键。 */
export const PLATFORM_DOCS_GLOBAL_DOMAIN = 'platform-docs';

interface GlobalKnowledgeShape {
    category?: string;
    metadata?: Record<string, unknown>;
}

/**
 * 读取一条资产的全局知识库域键。仅当它确实是全局知识库(category='knowledge' 且
 * metadata.knowledge.globalDomain 为非空字符串)时返回该域键,否则返回 null。
 */
export function resolveGlobalKnowledgeDomain(asset: GlobalKnowledgeShape | null | undefined): string | null {
    if (!asset || asset.category !== 'knowledge') {
        return null;
    }
    const knowledge = (asset.metadata as { knowledge?: { globalDomain?: unknown } } | undefined)?.knowledge;
    const domain = knowledge?.globalDomain;
    return typeof domain === 'string' && domain.trim().length > 0 ? domain : null;
}

/**
 * 是否为全局知识库资产(category='knowledge' 且 metadata.knowledge.globalDomain 为非空字符串)。
 * 写入授权放行 desktop-maintainer 在线编辑全局知识库时,以此谓词精确限定作用域。
 */
export function isGlobalKnowledgeAsset(asset: GlobalKnowledgeShape | null | undefined): boolean {
    return resolveGlobalKnowledgeDomain(asset) !== null;
}

/**
 * 是否已软归档(metadata.knowledge.archived === true)。归档是纯 jsonb 标记(无迁移):
 * 列表默认排除归档域,超管可显式 includeArchived 看到并取消归档。
 */
export function isGlobalKnowledgeArchived(asset: GlobalKnowledgeShape | null | undefined): boolean {
    const knowledge = (asset?.metadata as { knowledge?: { archived?: unknown } } | undefined)?.knowledge;
    return knowledge?.archived === true;
}

/**
 * 某域全局知识库的「域管理员 / steward」名单所在的元数据路径:
 * metadata.knowledge.maintainers(userId 字符串数组)。纯 jsonb 标记(无迁移)。
 */
export const GLOBAL_KNOWLEDGE_MAINTAINERS_METADATA_PATH = ['knowledge', 'maintainers'] as const;

/**
 * 读取某域全局知识库的域管理员(steward)userId 名单。仅当它确实是全局知识库且
 * metadata.knowledge.maintainers 为数组时返回去重、去空后的 userId 数组,否则返回空数组。
 * 域管理员是默认维护者之外、被授权【在线编辑该特定域】的本地用户。
 */
export function resolveGlobalKnowledgeMaintainers(asset: GlobalKnowledgeShape | null | undefined): string[] {
    if (!isGlobalKnowledgeAsset(asset)) {
        return [];
    }
    const raw = (asset?.metadata as { knowledge?: { maintainers?: unknown } } | undefined)?.knowledge?.maintainers;
    if (!Array.isArray(raw)) {
        return [];
    }
    const seen = new Set<string>();
    for (const entry of raw) {
        if (typeof entry === 'string') {
            const id = entry.trim();
            if (id) {
                seen.add(id);
            }
        }
    }
    return [...seen];
}

/**
 * 给定 userId 是否为【这条】全局知识库的域管理员(steward)。两个必要条件都满足才为 true:
 *   1. 该资产确为全局知识库(isGlobalKnowledgeAsset);
 *   2. userId 非空且出现在该资产的 metadata.knowledge.maintainers 名单中。
 *
 * 写入授权据此在 platform-bypass 之外,精确放行【被列入名单的用户】在线编辑【该特定域】,
 * 不放宽任何其它写入:非全局知识库 / 无 userId / 不在名单 → 一律 false。
 */
export function isGlobalKnowledgeMaintainer(
    asset: GlobalKnowledgeShape | null | undefined,
    userId: string | null | undefined,
): boolean {
    const normalized = userId?.trim();
    if (!normalized) {
        return false;
    }
    return resolveGlobalKnowledgeMaintainers(asset).includes(normalized);
}
