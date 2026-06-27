import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class KernelMessageImageRequestDto {
    @ApiProperty({ description: '图片 MIME 类型' })
    @IsString()
    mediaType: string;

    @ApiProperty({ description: '图片 base64 数据' })
    @IsString()
    data: string;
}

export class RunKernelSessionMessageRequestDto {
    @ApiProperty({ description: '用户消息内容' })
    @IsString()
    content: string;

    @ApiPropertyOptional({ description: '图片输入', type: [KernelMessageImageRequestDto] })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => KernelMessageImageRequestDto)
    images?: KernelMessageImageRequestDto[];

    @ApiPropertyOptional({ description: '本次运行覆盖模型' })
    @IsOptional()
    @IsString()
    model?: string;

    @ApiPropertyOptional({ description: '调用方元数据' })
    @IsOptional()
    @IsObject()
    metadata?: Record<string, unknown>;
}

export class AskKernelSessionBtwRequestDto {
    @ApiProperty({ description: 'BTW 查询内容' })
    @IsString()
    content: string;
}

class KernelVerificationCommandRequestDto {
    @ApiProperty({ description: '验证命令 ID' })
    @IsString()
    id: string;

    @ApiProperty({ description: '验证类型，如 unit-test / build / lint' })
    @IsString()
    kind: string;

    @ApiProperty({ description: '验证说明' })
    @IsString()
    description: string;

    @ApiProperty({ description: '要执行的命令' })
    @IsString()
    command: string;

    @ApiPropertyOptional({ description: '是否为必需验证' })
    @IsOptional()
    @IsBoolean()
    required?: boolean;

    @ApiPropertyOptional({ description: '单命令超时时间（毫秒）' })
    @IsOptional()
    timeoutMs?: number;
}

export class VerifyKernelSessionCommandsRequestDto {
    @ApiProperty({ description: '验证对象，例如 current-workspace 或 asset:xxx' })
    @IsString()
    subject: string;

    @ApiProperty({ description: '验证命令列表', type: [KernelVerificationCommandRequestDto] })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => KernelVerificationCommandRequestDto)
    commands: KernelVerificationCommandRequestDto[];
}
