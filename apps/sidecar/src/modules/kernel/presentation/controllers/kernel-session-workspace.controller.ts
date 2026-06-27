import {
	BadRequestException,
	Body,
	Controller,
	Param,
	Post,
	UploadedFile,
	UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiParam, ApiTags } from '@nestjs/swagger';
import { AuthenticatedApi } from '@/shared/security/desktop-access';
import { UploadSizeLimit } from '@/modules/config/presentation/interceptors/upload-size-limit.interceptor';
import {
	ApiBadRequestResponse,
	ApiCreatedResponse,
	ApiNotFoundResponse,
	ApiServerErrorResponse,
	ApiUnauthorizedResponse,
} from '@/shared/api';
import { CurrentUserId } from '@/shared/security/decorators/current-user.decorator';
import {
	SessionWorkspaceFileUploadService,
	type SessionWorkspaceUploadConflictStrategy,
} from '../../application/session-workspace-file-upload.service';
import {
	SessionWorkspaceUploadFileResponseDto,
	SessionWorkspaceUploadProgressResponseDto,
} from '../../dto/workspace.dto';

interface WorkspaceMultipartFile {
	originalname: string;
	mimetype: string;
	size: number;
	buffer: Buffer;
}

type ChunkUploadBodyValue = string | number | undefined;

@ApiTags('内核 - 会话工作区')
@AuthenticatedApi()
@Controller('kernel/sessions/:sessionId/workspace')
export class KernelSessionWorkspaceController {
	constructor(private readonly uploads: SessionWorkspaceFileUploadService) {}

	@Post('files/upload')
	// UploadSizeLimit:按平台配置(uploadMaxWorkspaceFileMb)实时限额并提前拒绝;512MB 仅 multer 绝对内存兜底。
	@UseInterceptors(
		UploadSizeLimit('uploadMaxWorkspaceFileMb'),
		FileInterceptor('file', { limits: { fileSize: 512 * 1024 * 1024 } }),
	)
	@ApiConsumes('multipart/form-data')
	@ApiBody({
		schema: {
			type: 'object',
			required: ['path', 'file'],
			properties: {
				path: {
					type: 'string',
					description: '文件相对路径；最终写入当前会话工作区',
					example: 'requirements.md',
				},
				conflictStrategy: {
					type: 'string',
					enum: ['overwrite', 'rename'],
					description: '同名文件处理策略；rename 会自动追加 -2、-3',
				},
				file: { type: 'string', format: 'binary' },
			},
		},
	})
	@ApiParam({ name: 'sessionId', description: '会话 ID' })
	@ApiCreatedResponse({
	    summary: '上传文件到当前会话工作区',
	    description: '根据 sessionId 校验会话归属，并把 multipart 文件写入该会话 cwd 下的相对路径。',
	    responseDescription: '返回会话工作区内的文件路径',
	    type: SessionWorkspaceUploadFileResponseDto,
	})
	@ApiBadRequestResponse({ description: '请求参数无效、缺少文件或路径不安全' })
	@ApiUnauthorizedResponse({ description: '未授权或 Token 无效' })
	@ApiNotFoundResponse({ description: '会话不存在或不属于当前用户' })
	@ApiServerErrorResponse()
	async uploadFile(
		@Param('sessionId') sessionId: string,
		@Body('path') targetPath: string | undefined,
		@Body('conflictStrategy') conflictStrategy: SessionWorkspaceUploadConflictStrategy | undefined,
		@UploadedFile() file: WorkspaceMultipartFile | undefined,
		@CurrentUserId() userId?: string,
	): Promise<SessionWorkspaceUploadFileResponseDto> {
		if (conflictStrategy && conflictStrategy !== 'overwrite' && conflictStrategy !== 'rename') {
			throw new BadRequestException('invalid conflictStrategy');
		}
		if (!file?.buffer) {
			throw new BadRequestException('file is required');
		}
		return this.uploads.uploadFile({
			sessionId,
			userId,
			path: targetPath ?? '',
			fileName: file.originalname,
			mimeType: file.mimetype,
			size: file.size,
			buffer: file.buffer,
			conflictStrategy,
		});
	}

	@Post('files/upload/chunks')
	@UseInterceptors(FileInterceptor('chunk', { limits: { fileSize: 64 * 1024 * 1024 } }))
	@ApiConsumes('multipart/form-data')
	@ApiBody({
		schema: {
			type: 'object',
			required: ['chunk'],
			properties: {
				uploadId: { type: 'string', description: '分片上传会话 ID；首片可省略，服务端会返回新 uploadId' },
				path: { type: 'string', description: '首片必填：文件相对路径' },
				fileName: { type: 'string', description: '原始文件名；默认使用 multipart filename' },
				mimeType: { type: 'string', description: 'MIME 类型' },
				size: { type: 'integer', minimum: 0, description: '首片必填：文件总大小（字节）' },
				offset: { type: 'integer', minimum: 0, description: '可选：当前分片起始字节；不传时服务端按已接收字节顺序追加' },
				chunkIndex: { type: 'integer', minimum: 0, description: '兼容旧客户端：0-based 分片序号' },
				totalChunks: { type: 'integer', minimum: 1, description: '兼容旧客户端：总分片数' },
				conflictStrategy: { type: 'string', enum: ['overwrite', 'rename'] },
				chunk: { type: 'string', format: 'binary' },
			},
		},
	})
	@ApiParam({ name: 'sessionId', description: '会话 ID' })
	@ApiCreatedResponse({
		summary: '上传一个文件分片',
		description: '首片只需带 path、size 和 chunk，服务端创建 uploadId；后续分片只需带 uploadId 和 chunk，服务端按顺序追加。达到 size 后自动合并，result 中返回最终文件。chunkIndex/totalChunks 仅用于兼容旧客户端。',
		type: SessionWorkspaceUploadProgressResponseDto,
	})
	async uploadChunk(
		@Param('sessionId') sessionId: string,
		@Body('uploadId') uploadId: string | undefined,
		@Body('path') targetPath: string | undefined,
		@Body('fileName') fileName: string | undefined,
		@Body('mimeType') mimeType: string | undefined,
		@Body('size') size: ChunkUploadBodyValue,
		@Body('offset') offset: ChunkUploadBodyValue,
		@Body('chunkIndex') chunkIndex: ChunkUploadBodyValue,
		@Body('totalChunks') totalChunks: ChunkUploadBodyValue,
		@Body('chunkCount') chunkCount: ChunkUploadBodyValue,
		@Body('conflictStrategy') conflictStrategy: SessionWorkspaceUploadConflictStrategy | undefined,
		@UploadedFile() chunk: WorkspaceMultipartFile | undefined,
		@CurrentUserId() userId?: string,
	): Promise<SessionWorkspaceUploadProgressResponseDto> {
		if (!chunk?.buffer) {
			throw new BadRequestException('chunk is required');
		}
		return this.uploads.uploadChunkedFile({
			sessionId,
			userId,
			uploadId,
			path: targetPath,
			fileName: fileName || chunk.originalname,
			mimeType: mimeType || chunk.mimetype,
			size: this.optionalInteger(size, 'size'),
			chunkCount: this.optionalInteger(chunkCount, 'chunkCount'),
			chunkIndex: this.optionalInteger(chunkIndex, 'chunkIndex'),
			offset: this.optionalInteger(offset, 'offset'),
			totalChunks: this.optionalInteger(totalChunks, 'totalChunks'),
			conflictStrategy,
			buffer: chunk.buffer,
		});
	}

	private integer(value: ChunkUploadBodyValue, field: string): number {
		const parsed = Number(value);
		if (!Number.isInteger(parsed)) {
			throw new BadRequestException(`${field} must be an integer`);
		}
		return parsed;
	}

	private optionalInteger(value: ChunkUploadBodyValue, field: string): number | undefined {
		if (value === undefined || value === '') {
			return undefined;
		}
		return this.integer(value, field);
	}
}
