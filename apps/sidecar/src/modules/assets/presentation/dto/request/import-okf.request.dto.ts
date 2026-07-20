import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';

export class ImportOkfFileRequestDto {
    @ApiPropertyOptional({ description: 'OKF bundle-relative Markdown path' })
    @IsOptional()
    @IsString()
    path?: string;

    @ApiPropertyOptional({ description: 'UTF-8 Markdown content' })
    @IsOptional()
    @IsString()
    content?: string;
}

export class ImportOkfRequestDto {
    @ApiPropertyOptional({ description: 'Base64-encoded OKF ZIP archive' })
    @IsOptional()
    @IsString()
    archiveBase64?: string;

    @ApiPropertyOptional({
        type: [ImportOkfFileRequestDto],
        description: 'Unarchived OKF Markdown files',
    })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ImportOkfFileRequestDto)
    files?: ImportOkfFileRequestDto[];

    @ApiPropertyOptional({
        description: 'Allow replacing existing OKF documents',
    })
    @IsOptional()
    @IsBoolean()
    overwrite?: boolean;
}
