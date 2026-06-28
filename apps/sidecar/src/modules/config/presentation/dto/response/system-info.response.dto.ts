import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SystemInfoResponseDto {
    @ApiPropertyOptional({ description: '应用名称', default: '书小安' })
    appName?: string;

    @ApiPropertyOptional({ description: 'Logo URL' })
    logoUrl?: string;

    @ApiProperty({ description: '版本号' })
    version!: string;
}
