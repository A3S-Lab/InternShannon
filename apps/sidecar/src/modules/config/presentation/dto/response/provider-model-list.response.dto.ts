import { ApiProperty } from '@nestjs/swagger';

export class ProviderModelCandidateResponseDto {
    @ApiProperty({ description: 'Provider 返回的模型 ID' })
    id!: string;

    @ApiProperty({ description: '模型显示名称；provider 未返回名称时等于 id' })
    name!: string;
}

export class ProviderModelListResponseDto {
    @ApiProperty({ description: 'Provider 标识' })
    providerName!: string;

    @ApiProperty({ description: '实际请求的 OpenAI-compatible /models URL' })
    baseUrl!: string;

    @ApiProperty({ description: '可导入的模型列表', type: [ProviderModelCandidateResponseDto] })
    models!: ProviderModelCandidateResponseDto[];
}
