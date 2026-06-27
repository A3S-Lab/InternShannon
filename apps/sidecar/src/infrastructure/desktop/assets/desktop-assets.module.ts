import { Module } from '@nestjs/common';
import { ASSET_REPOSITORY } from '../../../modules/assets/domain/repositories/asset.repository.interface';
import { DesktopAssetRepository } from './desktop-asset.repository';

@Module({
    providers: [
        {
            provide: ASSET_REPOSITORY,
            useClass: DesktopAssetRepository,
        },
    ],
    exports: [ASSET_REPOSITORY],
})
export class DesktopAssetsModule {}
