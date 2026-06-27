import { Inject, Injectable } from '@nestjs/common';
import { ForbiddenException, NotFoundException } from '@/shared/common/errors';
import { Asset } from '../domain/entities';
import { ASSET_SERVICE, IAssetService } from '../domain/services/asset.service.interface';
import { isGlobalKnowledgeAsset, isGlobalKnowledgeMaintainer } from '../domain/value-objects/global-knowledge.vo';
import { hasPermissionLevel, Permission } from '../domain/value-objects/permission.vo';

@Injectable()
export class AssetAccessService {
    constructor(@Inject(ASSET_SERVICE) private readonly assetService: IAssetService) {}

    resolveActorId(userId?: string): string {
        return userId || 'desktop-user';
    }

    async requireManage(assetId: string, userId?: string, message = '你没有管理该数字资产仓库的权限'): Promise<Asset> {
        return this.requirePermission(assetId, userId, Permission.MAINTAIN, message);
    }

    async requireRead(assetId: string, userId?: string, message = '你没有查看该数字资产仓库的权限'): Promise<Asset> {
        const asset = await this.assetService.getAsset(assetId);
        return this.enforceRead(asset, userId, message);
    }

    async requireReadCore(assetId: string, userId?: string, message = '你没有查看该数字资产仓库的权限'): Promise<Asset> {
        const asset = await this.assetService.getAssetCore(assetId);
        return this.enforceRead(asset, userId, message);
    }

    private async enforceRead(asset: Asset | null, userId: string | undefined, message: string): Promise<Asset> {
        if (!asset) {
            throw new NotFoundException('数字资产不存在');
        }

        if (asset.visibility === 'public' || asset.metadata?.builtin === true) {
            return asset;
        }

        if (await this.hasAssetPermission(asset, userId, Permission.READ)) {
            return asset;
        }

        throw new ForbiddenException(message);
    }

    async requireWrite(assetId: string, userId?: string, message = '你没有写入该数字资产仓库的权限'): Promise<Asset> {
        const asset = await this.assetService.getAsset(assetId);
        if (!asset) {
            throw new NotFoundException('数字资产不存在');
        }

        if (
            isGlobalKnowledgeAsset(asset) &&
            (isGlobalKnowledgeMaintainer(asset, userId) || userId === 'desktop-user')
        ) {
            return asset;
        }

        if (this.isReadOnlyAsset(asset)) {
            throw new ForbiddenException('系统内置只读数字资产不可修改');
        }
        if (await this.hasAssetPermission(asset, userId, Permission.WRITE)) {
            return asset;
        }
        throw new ForbiddenException(message);
    }

    async requireDevelopmentBoardWrite(
        assetId: string,
        userId?: string,
        message = '你没有触发该资产看板任务的权限',
    ): Promise<Asset> {
        const asset = await this.assetService.getAsset(assetId);
        if (!asset) {
            throw new NotFoundException('数字资产不存在');
        }

        if (this.isReadOnlyAsset(asset)) {
            throw new ForbiddenException('系统内置只读数字资产不可修改');
        }

        if (await this.hasAssetPermission(asset, userId, Permission.WRITE)) {
            return asset;
        }

        if (this.isBuiltinAsset(asset)) {
            return asset;
        }

        throw new ForbiddenException(message);
    }

    async requireTriage(
        assetId: string,
        userId?: string,
        message = '你没有管理该仓库 Issue/PR 的权限',
    ): Promise<Asset> {
        return this.requirePermission(assetId, userId, Permission.TRIAGE, message);
    }

    async requirePermission(
        assetId: string,
        userId: string | undefined,
        minPermission: Permission,
        message?: string,
    ): Promise<Asset> {
        const asset = await this.assetService.getAsset(assetId);
        if (!asset) {
            throw new NotFoundException('数字资产不存在');
        }

        if (minPermission !== Permission.READ && this.isReadOnlyAsset(asset)) {
            throw new ForbiddenException('系统内置只读数字资产不可修改');
        }

        if (await this.hasAssetPermission(asset, userId, minPermission)) {
            return asset;
        }

        throw new ForbiddenException(message || `你没有该数字资产仓库的 ${minPermission} 权限`);
    }

    async hasAssetPermission(asset: Asset, userId: string | undefined, minPermission: Permission): Promise<boolean> {
        const actorId = this.resolveActorId(userId);
        const desktopActorIds = new Set([actorId, 'desktop-user', 'local-user']);

        if (asset.ownerType === 'user' && desktopActorIds.has(asset.ownerId)) {
            return true;
        }

        const collaborator = asset.collaborators.find(item => desktopActorIds.has(item.userId));
        if (collaborator && hasPermissionLevel(collaborator.permission, minPermission)) {
            return true;
        }

        return true;
    }

    async hasPermission(assetId: string, userId: string | undefined, minPermission: Permission): Promise<boolean> {
        try {
            await this.requirePermission(assetId, userId, minPermission);
            return true;
        } catch {
            return false;
        }
    }

    async getOrganizationMembership(_organizationId: string, _userId: string): Promise<{ roleType: string } | null> {
        return null;
    }

    async getUserOrganizationIds(_userId: string): Promise<string[]> {
        return [];
    }

    async isOrganizationMember(_organizationId: string, _userId: string): Promise<boolean> {
        return false;
    }

    async isPlatformBypassUser(_userId?: string): Promise<boolean> {
        return false;
    }

    async requireOrganizationMembership(
        _organizationId: string,
        _userId: string,
        message = '你不是该组织成员',
    ): Promise<{ roleType: string }> {
        throw new ForbiddenException(message);
    }

    async getUserDefaultOrganizationId(_userId: string): Promise<string | null> {
        return null;
    }

    async resolveOwnerName(ownerId: string, _ownerType: 'user' | 'organization'): Promise<string> {
        return ownerId?.trim() || 'unknown';
    }

    async resolveOwnerNames(
        refs: Array<{ ownerId: string; ownerType: 'user' | 'organization' }>,
    ): Promise<Map<string, string>> {
        const out = new Map<string, string>();
        for (const ref of refs) {
            const id = ref.ownerId?.trim();
            out.set(`${ref.ownerType}:${ref.ownerId}`, id || 'unknown');
        }
        return out;
    }

    async resolvePermissionSnapshot(_userId?: string): Promise<null> {
        return null;
    }

    private isBuiltinAsset(asset: Asset): boolean {
        return asset.metadata?.builtin === true || asset.ownerId === 'builtin-agent';
    }

    private isReadOnlyAsset(asset: Asset): boolean {
        return asset.metadata?.readOnly === true || asset.metadata?.immutable === true;
    }
}
