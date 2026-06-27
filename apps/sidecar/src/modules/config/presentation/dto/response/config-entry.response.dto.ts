import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConfigEntryResponseDto {
    @ApiProperty({ description: '完整配置 key' })
    key!: string;

    @ApiProperty({ description: '配置值' })
    value!: string;

    @ApiPropertyOptional({ description: '配置版本' })
    version?: number;

    @ApiPropertyOptional({ description: '配置修订号' })
    revision?: number;
}
