import { Module } from '@nestjs/common';
import { DesktopAssetsModule } from '@/modules/assets/infrastructure/desktop/desktop-assets.module';
import { AssetAccessService } from '@/modules/assets/application/asset-access.service';
import { AssetServiceImpl } from '@/modules/assets/application/asset.service';
import { AssetUrlResolverService } from '@/modules/assets/application/asset-url-resolver.service';
import { ASSET_SERVICE } from '@/modules/assets/domain/services/asset.service.interface';
import { DesktopAssetsController } from '@/modules/assets/presentation/controllers/desktop-assets.controller';
import { DesktopConfigRuntimeModule } from './desktop-config-runtime.module';

@Module({
    imports: [DesktopAssetsModule, DesktopConfigRuntimeModule],
    controllers: [DesktopAssetsController],
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
