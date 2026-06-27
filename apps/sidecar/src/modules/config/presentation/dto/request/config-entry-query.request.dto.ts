import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { PaginationQueryDto } from '@/shared/application/pagination.dto';

const CONFIG_ENTRY_PREFIX_PATTERN = /^config(?:\/.*)?$/;
const CONFIG_ENTRY_KEY_PATTERN = /^config\/.+$/;

export class ConfigEntryListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '配置前缀，必须使用完整配置路径', example: 'config/system' })
  @IsOptional()
  @IsString()
  @Matches(CONFIG_ENTRY_PREFIX_PATTERN, {
    message: 'prefix must start with "config"',
  })
  prefix?: string;
}

export class ConfigEntryKeyQueryDto {
  @ApiProperty({ description: '完整配置 key', example: 'config/system/banner' })
  @IsString()
  @IsNotEmpty()
  @Matches(CONFIG_ENTRY_KEY_PATTERN, {
    message: 'key must start with "config/"',
  })
  key!: string;
}
