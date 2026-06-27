import { SetMetadata, Type } from '@nestjs/common';

export const API_LAYER_METADATA = 'api:layer';
export const API_LAYERS = ['platform', 'infrastructure'] as const;

export type ApiLayer = typeof API_LAYERS[number];

export const PlatformApiLayer = (): ClassDecorator => SetMetadata(API_LAYER_METADATA, 'platform');
export const InfrastructureApiLayer = (): ClassDecorator => SetMetadata(API_LAYER_METADATA, 'infrastructure');

export function readApiLayer(target: Type<unknown>): ApiLayer | undefined {
    return Reflect.getMetadata(API_LAYER_METADATA, target) as ApiLayer | undefined;
}
