import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export class WorkspaceReadinessDto {
    workspaceRoot!: string;
    rootExists!: boolean;
    agentsExists!: boolean;
    sessionsExists!: boolean;
    needsRepair!: boolean;
    platform!: string;
    isWindows!: boolean;
}

export class WsDirEntryDto {
    name!: string;
    isDirectory!: boolean;
    isFile!: boolean;
    size?: number;
    mtimeMs?: number;
    modifiedAt?: string;
    extension?: string;
    isBinary?: boolean;
}

export class InspectReadinessQueryDto {
    @IsOptional()
    @IsString()
    workspaceRoot?: string;
}

export class EnsureReadinessQueryDto {
    @IsOptional()
    @IsString()
    workspaceRoot?: string;
}

export class InitAgentDto {
    @IsString()
    workspacePath!: string;
}

export class MkdirDto {
    @IsString()
    path!: string;
}

export class WriteFileDto {
    @IsString()
    path!: string;

    @IsString()
    content!: string;
}

export class ReadFileQueryDto {
    @IsString()
    path!: string;
}

export class WorkspaceOcrDto {
    @IsString()
    path!: string;

    @IsOptional()
    @IsString()
    backend?: string;

    @IsOptional()
    @IsIn(['text', 'markdown', 'json'])
    outputFormat?: 'text' | 'markdown' | 'json';

    @IsOptional()
    timeoutMs?: number;
}

export class FileExistsQueryDto {
    @IsString()
    path!: string;
}

export class RemoveQueryDto {
    @IsString()
    path!: string;
}

export class ReadDirQueryDto {
    @IsString()
    path!: string;
}

export class RenameDto {
    @IsString()
    src!: string;

    @IsString()
    dest!: string;
}

export class CopyFileDto {
    @IsString()
    src!: string;

    @IsString()
    dest!: string;
}

export class ReadBinaryQueryDto {
    @IsString()
    path!: string;
}

export class WriteBinaryDto {
    @IsString()
    path!: string;

    data!: number[];
}

export class SessionWorkspaceUploadFileResponseDto {
    @ApiProperty({
        description: '上传成功标志。成功响应中始终为 true；失败时通过 HTTP 错误码与错误 envelope 表达。',
        example: true,
    })
    success!: boolean;

    @ApiProperty({
        description: '操作消息。成功响应固定为 `File uploaded successfully`，仅用于显示，不要据此判断成功/失败。',
        example: 'File uploaded successfully',
    })
    message!: string;

    @ApiProperty({
        description: '本次上传事件 ID，可与会话事件中的 `file_attached` 记录对齐审计。',
        example: 'wup-1715846400000-a1b2c3',
    })
    uploadId!: string;

    @ApiProperty({
        description: '实际落盘的相对路径。当 `conflictStrategy=rename` 且发生冲突时，与请求中的 `path` 不同。',
        example: 'uploads/example.png',
    })
    path!: string;

    @ApiProperty({
        description:
            '文件在会话工作区中的完整本地存储路径。',
        example: '/Users/me/.internshannon/workspace/uploads/example.png',
    })
    workspacePath!: string;

    @ApiProperty({ description: '原始文件名（来自 multipart 的 filename 字段）', example: 'example.png' })
    fileName!: string;

    @ApiProperty({ description: '文件大小（字节）', example: 1024 })
    size!: number;

    @ApiPropertyOptional({
        description: '客户端在 multipart 中声明的 MIME 类型；客户端未声明时为空。',
        example: 'image/png',
    })
    mimeType?: string;

    @ApiProperty({
        description: '文件内容 SHA-256 摘要（小写十六进制，64 字符）。可用于完整性校验和去重。',
        example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    })
	sha256!: string;
}

export class SessionWorkspaceUploadProgressResponseDto {
	@ApiProperty({ description: '分段上传会话 ID', example: 'wup-1715846400000-a1b2c3' })
	uploadId!: string;

	@ApiProperty({ description: '上传状态', enum: ['uploading', 'completed'], example: 'uploading' })
	status!: 'uploading' | 'completed';

	@ApiProperty({ description: '最终写入的相对路径', example: 'uploads/example.png' })
	path!: string;

	@ApiProperty({ description: '原始文件名', example: 'example.png' })
	fileName!: string;

	@ApiProperty({ description: '文件总大小（字节）', example: 10485760 })
	size!: number;

	@ApiPropertyOptional({ description: 'MIME 类型', example: 'image/png' })
	mimeType?: string;

	@ApiPropertyOptional({ description: '兼容旧客户端：分片大小（字节）', example: 1048576 })
	chunkSize?: number;

	@ApiPropertyOptional({ description: '兼容旧客户端：总分片数', example: 10 })
	chunkCount?: number;

	@ApiProperty({ description: '已收到的分片数', example: 3 })
	receivedChunks!: number;

	@ApiProperty({ description: '服务端已连续接收字节数；可作为下一片默认追加位置', example: 3145728 })
	uploadedBytes!: number;

	@ApiProperty({ description: '服务端接收进度百分比，0-100', example: 30 })
	progress!: number;

	@ApiProperty({ description: '是否已完成合并落盘', example: false })
	completed!: boolean;

	@ApiPropertyOptional({ description: '完成合并后的最终上传结果', type: SessionWorkspaceUploadFileResponseDto })
	result?: SessionWorkspaceUploadFileResponseDto;
}

export class WorkspaceUploadDto {
    uploadId!: string;
    ownerId!: string;
    fileName!: string;
    relativePath?: string;
    path!: string;
    workspaceRoot!: string;
    mimeType?: string;
    size!: number;
    sha256!: string;
    metadata!: Record<string, unknown>;
    createdAt!: string;
    updatedAt!: string;
}

export class ListWorkspaceUploadsQueryDto {
    @ApiPropertyOptional({ description: '工作区根路径；不传时使用默认工作区' })
    @IsOptional()
    @IsString()
    workspaceRoot?: string;
}

export class GetWorkspaceUploadQueryDto {
    @ApiPropertyOptional({ description: '工作区根路径；不传时使用默认工作区' })
    @IsOptional()
    @IsString()
    workspaceRoot?: string;
}

export class CreateWorkspaceUploadDto {
    @ApiPropertyOptional({ description: '工作区根路径；不传时使用默认工作区' })
    @IsOptional()
    @IsString()
    workspaceRoot?: string;

    @ApiProperty({ description: '上传文件名' })
    @IsString()
    fileName!: string;

    @ApiPropertyOptional({ description: '文件夹上传时的相对路径' })
    @IsOptional()
    @IsString()
    relativePath?: string;

    @ApiPropertyOptional({ description: 'MIME 类型' })
    @IsOptional()
    @IsString()
    mimeType?: string;

    @ApiPropertyOptional({
        description: '内容编码；dataBase64 总是按 base64 处理，content 可按 utf8/base64 处理',
        enum: ['base64', 'utf8', 'bytes'],
    })
    @IsOptional()
    @IsIn(['base64', 'utf8', 'bytes'])
    encoding?: 'base64' | 'utf8' | 'bytes';

    @ApiPropertyOptional({ description: 'Base64 文件内容' })
    @IsOptional()
    @IsString()
    dataBase64?: string;

    @ApiPropertyOptional({ description: '文本内容；encoding=base64 时按 base64 解码' })
    @IsOptional()
    @IsString()
    content?: string;

    @ApiPropertyOptional({ description: '字节数组内容', type: [Number] })
    @IsOptional()
    @IsArray()
    data?: number[];

    @ApiPropertyOptional({ description: '上传元数据', type: 'object', additionalProperties: true })
    @IsOptional()
    @IsObject()
    metadata?: Record<string, unknown>;
}

export class SearchInFilesQueryDto {
    @ApiProperty({ description: '搜索根路径' })
    @IsString()
    rootPath!: string;

    @ApiProperty({ description: '搜索查询字符串' })
    @IsString()
    query!: string;

    @ApiPropertyOptional({ description: '是否区分大小写' })
    @IsOptional()
    caseSensitive?: boolean;

    @ApiPropertyOptional({ description: '是否使用正则表达式' })
    @IsOptional()
    useRegex?: boolean;

    @ApiPropertyOptional({ description: '是否整词匹配' })
    @IsOptional()
    matchWholeWord?: boolean;

    @ApiPropertyOptional({ description: '包含文件 glob，多个用逗号分隔' })
    @IsOptional()
    @IsString()
    includePattern?: string;

    @ApiPropertyOptional({ description: '排除文件 glob，多个用逗号分隔' })
    @IsOptional()
    @IsString()
    excludePattern?: string;

    @ApiPropertyOptional({ description: '最大结果数量' })
    @IsOptional()
    maxResults?: number;
}

export class SearchMatchDto {
    line!: number;
    column!: number;
    text!: string;
    matchStart!: number;
    matchEnd!: number;
}

export class SearchResultDto {
    path!: string;
    matches!: SearchMatchDto[];
}

export class ReplaceInFilesDto {
    @ApiProperty({ description: '搜索根路径' })
    @IsString()
    rootPath!: string;

    @ApiProperty({ description: '搜索查询字符串' })
    @IsString()
    query!: string;

    @ApiProperty({ description: '替换字符串' })
    @IsString()
    replacement!: string;

    @ApiPropertyOptional({ description: '是否区分大小写' })
    @IsOptional()
    caseSensitive?: boolean;

    @ApiPropertyOptional({ description: '是否使用正则表达式' })
    @IsOptional()
    useRegex?: boolean;

    @ApiPropertyOptional({ description: '是否整词匹配' })
    @IsOptional()
    matchWholeWord?: boolean;

    @ApiPropertyOptional({ description: '包含文件 glob，多个用逗号分隔' })
    @IsOptional()
    @IsString()
    includePattern?: string;

    @ApiPropertyOptional({ description: '排除文件 glob，多个用逗号分隔' })
    @IsOptional()
    @IsString()
    excludePattern?: string;

    @ApiPropertyOptional({ description: '要替换的文件路径列表（相对路径）', type: [String] })
    @IsOptional()
    @IsArray()
    filePaths?: string[];
}

export class ReplaceResultDto {
    filesModified!: number;
    totalReplacements!: number;
    files!: Array<{
        path: string;
        replacements: number;
    }>;
}

export class GitStatusQueryDto {
    @ApiProperty({ description: 'Git 仓库根路径' })
    @IsString()
    rootPath!: string;
}

export class GitFileStatusDto {
    path!: string;
    status!: string; // M=modified, A=added, D=deleted, U=untracked, R=renamed, C=copied, ??=untracked
    staged!: boolean;
}

export class GitStatusResultDto {
    isGitRepo!: boolean;
    branch?: string;
    files!: GitFileStatusDto[];
}
