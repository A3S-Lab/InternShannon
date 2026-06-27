import { Module } from '@nestjs/common';
import { DesktopAssetsModule } from '@/infrastructure/desktop/assets/desktop-assets.module';
import { AssetAccessService } from '@/modules/assets/application/asset-access.service';
import { AssetServiceImpl } from '@/modules/assets/application/asset.service';
import { AssetUrlResolverService } from '@/modules/assets/application/asset-url-resolver.service';
import { ASSET_SERVICE } from '@/modules/assets/domain/services/asset.service.interface';
import { DesktopConfigRuntimeModule } from './desktop-config-runtime.module';

@Module({
    imports: [DesktopAssetsModule, DesktopConfigRuntimeModule],
    providers: [
        AssetServiceImpl,
        AssetAccessService,
        AssetUrlResolverService,
        {
            provide: ASSET_SERVICE,
            useExisting: AssetServiceImpl,
        },
    ],
    exports: [ASSET_SERVICE, AssetAccessService, AssetUrlResolverService],
})
export class DesktopAssetsRuntimeModule {}
