import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

const CONFIG_ENTRY_KEY_PATTERN = /^config\/.+$/;

export class UpsertConfigEntryRequestDto {
    @ApiProperty({ description: '完整配置 key，必须使用完整配置路径', example: 'config/system/banner' })
    @IsString()
    @IsNotEmpty()
    @Matches(CONFIG_ENTRY_KEY_PATTERN, {
        message: 'key must start with "config/"',
    })
    key!: string;

    @ApiProperty({ description: '配置值，建议 JSON 配置使用格式化后的字符串' })
    @IsString()
    @IsNotEmpty()
    value!: string;
}
