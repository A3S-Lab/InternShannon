import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';

export class FetchProviderModelsRequestDto {
    @ApiProperty({ description: 'Provider 标识，如 openai 或自定义 OpenAI-compatible provider 名称' })
    @IsString()
    providerName!: string;

    @ApiPropertyOptional({ description: 'OpenAI-compatible Base URL；不包含 /v1 时后端会自动补 /v1/models' })
    @IsOptional()
    @IsString()
    baseUrl?: string;

    @ApiPropertyOptional({ description: 'Provider API Key；留空时尝试使用已保存配置或环境变量' })
    @IsOptional()
    @IsString()
    apiKey?: string;

    @ApiPropertyOptional({ type: Object, description: '透传给 provider 的额外请求头' })
    @IsOptional()
    @IsObject()
    headers?: Record<string, string>;
}
