import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
    ApiBadRequestResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiRawResponse,
    ApiServerErrorResponse,
    ApiUnauthorizedResponse,
    SkipApiResponse,
} from '@/shared/api';
import { DesktopOwnerId } from '@/shared/security/decorators/desktop-owner.decorator';
import { DesktopApi } from '@/shared/security/desktop-access';
import { WorkspaceUploadService } from '../../application/workspace-upload.service';
import { IWorkspaceStorage, WORKSPACE_STORAGE } from '../../domain/services/workspace-storage.interface';
import {
    CopyFileDto,
    CreateWorkspaceUploadDto,
    EnsureReadinessQueryDto,
    FileExistsQueryDto,
    GetWorkspaceUploadQueryDto,
    GitStatusQueryDto,
    GitStatusResultDto,
    InitAgentDto,
    InspectReadinessQueryDto,
    ListWorkspaceUploadsQueryDto,
    MkdirDto,
    RemoveQueryDto,
    RenameDto,
    ReplaceInFilesDto,
    ReplaceResultDto,
    ReadBinaryQueryDto,
    ReadDirQueryDto,
    ReadFileQueryDto,
    SearchInFilesQueryDto,
    SearchResultDto,
    WorkspaceUploadDto,
    WriteBinaryDto,
    WriteFileDto,
} from '../dto/workspace.dto';

@ApiTags('内核 - 工作区')
@DesktopApi()
@Controller('workspace')
export class WorkspaceController {
    constructor(
        @Inject(WORKSPACE_STORAGE) private readonly storage: IWorkspaceStorage,
        private readonly uploads: WorkspaceUploadService,
    ) {}

    @Get('default-root')
    @ApiOkResponse({
        summary: '获取默认根目录',
        description: '返回桌面端默认工作区根目录路径。',
        responseDescription: '返回默认工作区根目录路径',
    })
    @ApiUnauthorizedResponse({ description: '未授权或 Token 无效' })
    @ApiServerErrorResponse()
    async getDefaultRoot() {
        return { root: await this.storage.getDefaultRoot() };
    }

    @Get('readiness')
    @ApiOkResponse({
        summary: '检查工作区就绪状态',
        description: '检查指定工作区目录是否已准备完成，包括必要的子目录（agents、sessions）是否存在。',
        responseDescription: '返回工作区就绪状态详情',
    })
    @ApiBadRequestResponse({ description: '请求参数无效' })
    @ApiUnauthorizedResponse({ description: '未授权或 Token 无效' })
    @ApiServerErrorResponse()
    async inspectReadiness(@Query() query: InspectReadinessQueryDto, @DesktopOwnerId() userId?: string) {
        await this.assertWorkspaceRootAccess(query.workspaceRoot, userId);
        return this.storage.inspectReadiness(query.workspaceRoot);
    }

    @Post('readiness')
    @ApiOkResponse({
        summary: '确保工作区就绪',
        description: '创建或修复指定工作区需要的基础目录和文件。如果目录不存在则自动创建。',
        responseDescription: '返回工作区就绪状态',
    })
    @ApiBadRequestResponse({ description: '请求参数无效' })
    @ApiUnauthorizedResponse({ description: '未授权或 Token 无效' })
    @ApiServerErrorResponse()
    async ensureReadiness(@Query() query: EnsureReadinessQueryDto, @DesktopOwnerId() userId?: string) {
        await this.assertWorkspaceRootAccess(query.workspaceRoot, userId);
        return this.storage.ensureReadiness(query.workspaceRoot);
    }

    @Post('init-agent')
    @ApiOkResponse({
        summary: '初始化智能体工作区',
        description: '在指定工作区路径初始化智能体运行所需的目录结构和配置文件。',
        responseDescription: '返回操作结果',
    })
    @ApiBadRequestResponse({ description: '请求参数无效或路径不安全' })
    @ApiUnauthorizedResponse({ description: '未授权或 Token 无效' })
    @ApiServerErrorResponse()
    async initAgent(@Body() body: InitAgentDto, @DesktopOwnerId() userId?: string) {
        await this.assertWorkspacePathAccess(body.workspacePath, userId);
        await this.storage.initAgent(body.workspacePath);
        return { success: true };
    }

    @Post('mkdir')
    @ApiOkResponse({
        summary: '创建目录',
        description: '在工作区中创建指定路径的目录。支持递归创建父目录（类似 mkdir -p）。',
        responseDescription: '返回操作结果',
    })
    @ApiBadRequestResponse({ description: '请求参数无效或路径不安全' })
    @ApiUnauthorizedResponse({ description: '未授权或 Token 无效' })
    @ApiServerErrorResponse()
    async mkdir(@Body() body: MkdirDto, @DesktopOwnerId() userId?: string) {
        await this.assertWorkspacePathAccess(body.path, userId);
        await this.storage.mkdir(body.path);
        return { success: true };
    }

    @Post('write')
    @ApiOkResponse({
        summary: '写入文本文件',
        description: '向工作区指定路径写入文本内容。如果文件已存在则覆盖，如果父目录不存在则自动创建。',
        responseDescription: '返回操作结果',
    })
    @ApiBadRequestResponse({ description: '请求参数无效或路径不安全' })
    @ApiUnauthorizedResponse({ description: '未授权或 Token 无效' })
    @ApiServerErrorResponse()
    async writeFile(@Body() body: WriteFileDto, @DesktopOwnerId() userId?: string) {
        await this.assertWorkspacePathAccess(body.path, userId);
        await this.storage.writeFile(body.path, body.content);
        return { success: true };
    }

    @Get('read')
    @ApiOkResponse({
        summary: '读取文本文件',
        description: '读取工作区指定路径的文本文件内容。仅支持文本文件，二进制文件请使用 read-binary 接口。',
        responseDescription: '返回文件内容',
    })
    @ApiBadRequestResponse({ description: '请求参数无效或路径不安全' })
    @ApiUnauthorizedResponse({ description: '未授权或 Token 无效' })
    @ApiNotFoundResponse({ description: '文件不存在' })
    @ApiServerErrorResponse()
    async readFile(@Query() query: ReadFileQueryDto, @DesktopOwnerId() userId?: string) {
        await this.assertWorkspacePathAccess(query.path, userId);
        return { content: await this.storage.readFile(query.path) };
    }

    @Get('exists')
    @ApiOkResponse({
        summary: '检查路径存在',
        description: '检查工作区中指定路径的文件或目录是否存在。',
        responseDescription: '返回路径是否存在',
    })
    @ApiBadRequestResponse({ description: '请求参数无效或路径不安全' })
    @ApiUnauthorizedResponse({ description: '未授权或 Token 无效' })
    @ApiServerErrorResponse()
    async fileExists(@Query() query: FileExistsQueryDto, @DesktopOwnerId() userId?: string) {
        await this.assertWorkspacePathAccess(query.path, userId);
        return { exists: await this.storage.exists(query.path) };
    }

    @Delete('delete')
    @ApiOkResponse({
        summary: '删除路径',
        description: '删除工作区中指定的文件或目录。如果是目录则递归删除所有内容。此操作不可逆。',
        responseDescription: '返回操作结果',
    })
    @ApiBadRequestResponse({ description: '请求参数无效或路径不安全' })
    @ApiUnauthorizedResponse({ description: '未授权或 Token 无效' })
    @ApiNotFoundResponse({ description: '文件或目录不存在' })
    @ApiServerErrorResponse()
    async remove(@Query() query: RemoveQueryDto, @DesktopOwnerId() userId?: string) {
        await this.assertWorkspacePathAccess(query.path, userId);
        await this.storage.remove(query.path);
        return { success: true };
    }

    @Get('read-dir')
    @ApiOkResponse({
        summary: '读取目录内容',
        description: '列出工作区指定目录下的所有文件和子目录，包含文件元数据（大小、修改时间、类型等）。',
        responseDescription: '返回目录内容列表',
    })
    @ApiBadRequestResponse({ description: '请求参数无效或路径不安全' })
    @ApiUnauthorizedResponse({ description: '未授权或 Token 无效' })
    @ApiNotFoundResponse({ description: '目录不存在' })
    @ApiServerErrorResponse()
    async readDir(@Query() query: ReadDirQueryDto, @DesktopOwnerId() userId?: string) {
        await this.assertWorkspacePathAccess(query.path, userId);
        return this.storage.readDir(query.path);
    }

    @Post('rename')
    @ApiOkResponse({
        summary: '重命名路径',
        description: '将工作区中的文件或目录移动或重命名到目标路径。如果目标路径已存在则覆盖。',
        responseDescription: '返回操作结果',
    })
    @ApiBadRequestResponse({ description: '请求参数无效或路径不安全' })
    @ApiUnauthorizedResponse({ description: '未授权或 Token 无效' })
    @ApiNotFoundResponse({ description: '源路径不存在' })
    @ApiServerErrorResponse()
    async rename(@Body() body: RenameDto, @DesktopOwnerId() userId?: string) {
        await this.assertWorkspacePathAccess(body.src, userId);
        await this.assertWorkspacePathAccess(body.dest, userId);
        await this.storage.rename(body.src, body.dest);
        return { success: true };
    }

    @Post('copy')
    @ApiOkResponse({
        summary: '复制文件',
        description: '将工作区中的文件复制到目标路径。源文件保持不变。',
        responseDescription: '返回操作结果',
    })
    @ApiBadRequestResponse({ description: '请求参数无效或路径不安全' })
    @ApiUnauthorizedResponse({ description: '未授权或 Token 无效' })
    @ApiNotFoundResponse({ description: '源文件不存在' })
    @ApiServerErrorResponse()
    async copyFile(@Body() body: CopyFileDto, @DesktopOwnerId() userId?: string) {
        await this.assertWorkspacePathAccess(body.src, userId);
        await this.assertWorkspacePathAccess(body.dest, userId);
        await this.storage.copyFile(body.src, body.dest);
        return { success: true };
    }

    @Get('read-binary')
    @SkipApiResponse()
    @ApiRawResponse({
        summary: '读取二进制文件',
        description:
            '以 application/octet-stream 格式返回工作区指定路径的二进制文件内容。适用于图片、压缩包等二进制文件。',
        responseDescription: '返回二进制文件内容',
        contentType: 'application/octet-stream',
    })
    @ApiBadRequestResponse({ description: '请求参数无效或路径不安全' })
    @ApiUnauthorizedResponse({ description: '未授权或 Token 无效' })
    @ApiNotFoundResponse({ description: '文件不存在' })
    @ApiServerErrorResponse()
    async readBinaryFile(
        @Query() query: ReadBinaryQueryDto,
        @DesktopOwnerId() userId: string | undefined,
        @Res() res: Response,
    ) {
        await this.assertWorkspacePathAccess(query.path, userId);
        const buffer = await this.storage.readBinaryFile(query.path);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.send(buffer);
    }

    @Post('write-binary')
    @ApiOkResponse({
        summary: '写入二进制文件',
        description: '将二进制数据（Buffer 或 base64 编码）写入工作区指定路径。适用于图片、压缩包等二进制文件。',
        responseDescription: '返回操作结果',
    })
    @ApiBadRequestResponse({ description: '请求参数无效或路径不安全' })
    @ApiUnauthorizedResponse({ description: '未授权或 Token 无效' })
    @ApiServerErrorResponse()
    async writeBinaryFile(@Body() body: WriteBinaryDto, @DesktopOwnerId() userId?: string) {
        await this.assertWorkspacePathAccess(body.path, userId);
        await this.storage.writeBinaryFile(body.path, Buffer.from(body.data));
        return { success: true };
    }

    @Get('uploads')
    @ApiOkResponse({
        summary: '查询工作区上传附件',
        description: '列出当前用户在指定工作区中的上传附件列表。可用于任务工作台、智能体制造等场景。',
        responseDescription: '返回上传附件列表',
        type: WorkspaceUploadDto,
        isArray: true,
    })
    @ApiBadRequestResponse({ description: '请求参数无效' })
    @ApiUnauthorizedResponse({ description: '未授权或 Token 无效' })
    @ApiServerErrorResponse()
    async listUploads(@Query() query: ListWorkspaceUploadsQueryDto, @DesktopOwnerId() userId?: string) {
        await this.assertWorkspaceRootAccess(query.workspaceRoot, userId);
        return this.uploads.list(query, this.resolveUserId(userId));
    }

    @Post('uploads')
    @ApiOkResponse({
        summary: '上传工作区附件',
        description: '写入附件内容并记录附件元数据。可用于任务工作台、智能体制造、质检和成品仓等通用场景。',
        responseDescription: '返回附件元数据',
        type: WorkspaceUploadDto,
    })
    @ApiBadRequestResponse({ description: '请求参数无效或文件过大' })
    @ApiUnauthorizedResponse({ description: '未授权或 Token 无效' })
    @ApiServerErrorResponse()
    async createUpload(@Body() body: CreateWorkspaceUploadDto, @DesktopOwnerId() userId?: string) {
        await this.assertWorkspaceRootAccess(body.workspaceRoot, userId);
        return this.uploads.create(body, this.resolveUserId(userId));
    }

    @Get('uploads/:uploadId')
    @ApiOkResponse({
        summary: '获取工作区上传附件元数据',
        description: '获取指定上传附件的元数据信息，包括文件名、大小、MIME 类型等。',
        responseDescription: '返回附件元数据',
        type: WorkspaceUploadDto,
    })
    @ApiBadRequestResponse({ description: '请求参数无效' })
    @ApiUnauthorizedResponse({ description: '未授权或 Token 无效' })
    @ApiNotFoundResponse({ description: '附件不存在' })
    @ApiServerErrorResponse()
    async getUpload(
        @Param('uploadId') uploadId: string,
        @Query() query: GetWorkspaceUploadQueryDto,
        @DesktopOwnerId() userId: string | undefined,
    ) {
        await this.assertWorkspaceRootAccess(query.workspaceRoot, userId);
        return this.uploads.get(uploadId, query.workspaceRoot, this.resolveUserId(userId));
    }

    @Get('uploads/:uploadId/download')
    @SkipApiResponse()
    @ApiRawResponse({
        summary: '下载工作区上传附件',
        description: '以原始二进制流下载上传附件。响应头包含 Content-Type 和 Content-Disposition。',
        responseDescription: '返回附件二进制内容',
        contentType: 'application/octet-stream',
    })
    @ApiBadRequestResponse({ description: '请求参数无效' })
    @ApiUnauthorizedResponse({ description: '未授权或 Token 无效' })
    @ApiNotFoundResponse({ description: '附件不存在' })
    @ApiServerErrorResponse()
    async downloadUpload(
        @Param('uploadId') uploadId: string,
        @Query() query: GetWorkspaceUploadQueryDto,
        @DesktopOwnerId() userId: string | undefined,
        @Res() res: Response,
    ) {
        await this.assertWorkspaceRootAccess(query.workspaceRoot, userId);
        const upload = await this.uploads.read(uploadId, query.workspaceRoot, this.resolveUserId(userId));
        res.setHeader('Content-Type', upload.metadata.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(upload.metadata.fileName)}"`);
        res.send(upload.data);
    }

    @Delete('uploads/:uploadId')
    @ApiOkResponse({
        summary: '删除工作区上传附件',
        description: '删除指定上传附件及其元数据。此操作不可逆。',
        responseDescription: '返回操作结果',
    })
    @ApiBadRequestResponse({ description: '请求参数无效' })
    @ApiUnauthorizedResponse({ description: '未授权或 Token 无效' })
    @ApiNotFoundResponse({ description: '附件不存在' })
    @ApiServerErrorResponse()
    async deleteUpload(
        @Param('uploadId') uploadId: string,
        @Query() query: GetWorkspaceUploadQueryDto,
        @DesktopOwnerId() userId: string | undefined,
    ) {
        await this.assertWorkspaceRootAccess(query.workspaceRoot, userId);
        await this.uploads.delete(uploadId, query.workspaceRoot, this.resolveUserId(userId));
        return { success: true };
    }

    @Get('search')
    @ApiOkResponse({
        summary: '搜索文件内容',
        description: '在指定目录下搜索文件内容。支持正则表达式、大小写敏感、全词匹配、文件过滤等高级选项。',
        responseDescription: '返回匹配的文件和行信息',
        type: SearchResultDto,
        isArray: true,
    })
    @ApiBadRequestResponse({ description: '请求参数无效或路径不安全' })
    @ApiUnauthorizedResponse({ description: '未授权或 Token 无效' })
    @ApiServerErrorResponse()
    async searchInFiles(@Query() query: SearchInFilesQueryDto, @DesktopOwnerId() userId?: string) {
        await this.assertWorkspacePathAccess(query.rootPath, userId);
        return this.storage.searchInFiles(query.rootPath, query.query, {
            caseSensitive: query.caseSensitive,
            useRegex: query.useRegex,
            matchWholeWord: query.matchWholeWord,
            includePattern: query.includePattern,
            excludePattern: query.excludePattern,
            maxResults: query.maxResults,
        });
    }

    @Post('replace')
    @ApiOkResponse({
        summary: '替换文件内容',
        description:
            '在指定目录下批量替换文件内容。支持正则表达式、大小写敏感、全词匹配、文件过滤等高级选项。可指定特定文件或全部匹配文件。',
        responseDescription: '返回替换统计信息',
        type: ReplaceResultDto,
    })
    @ApiBadRequestResponse({ description: '请求参数无效或路径不安全' })
    @ApiUnauthorizedResponse({ description: '未授权或 Token 无效' })
    @ApiServerErrorResponse()
    async replaceInFiles(@Body() body: ReplaceInFilesDto, @DesktopOwnerId() userId?: string) {
        await this.assertWorkspacePathAccess(body.rootPath, userId);
        this.assertRelativeFilePaths(body.filePaths);
        return this.storage.replaceInFiles(body.rootPath, body.query, body.replacement, {
            caseSensitive: body.caseSensitive,
            useRegex: body.useRegex,
            matchWholeWord: body.matchWholeWord,
            includePattern: body.includePattern,
            excludePattern: body.excludePattern,
            filePaths: body.filePaths,
        });
    }

    @Get('git-status')
    @ApiOkResponse({
        summary: '获取 Git 状态',
        description: '获取指定目录的 Git 仓库状态，包括当前分支名、文件变更状态（新增、修改、删除等）。',
        responseDescription: '返回 Git 状态信息',
        type: GitStatusResultDto,
    })
    @ApiBadRequestResponse({ description: '请求参数无效或路径不安全' })
    @ApiUnauthorizedResponse({ description: '未授权或 Token 无效' })
    @ApiServerErrorResponse()
    async getGitStatus(
        @Query() query: GitStatusQueryDto,
        @DesktopOwnerId() userId?: string,
    ): Promise<GitStatusResultDto> {
        const { rootPath } = query;
        await this.assertWorkspacePathAccess(rootPath, userId);
        const { execSync } = require('child_process');

        try {
            // Check if it's a git repository
            execSync('git rev-parse --git-dir', { cwd: rootPath, stdio: 'pipe' });

            // Get current branch
            let branch: string | undefined;
            try {
                branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: rootPath, encoding: 'utf-8' }).trim();
            } catch {
                branch = undefined;
            }

            // Get file status
            const statusOutput = execSync('git status --porcelain', { cwd: rootPath, encoding: 'utf-8' });
            const files: any[] = [];

            if (statusOutput) {
                const lines = statusOutput.split('\n').filter((line: string) => line.trim());
                for (const line of lines) {
                    if (line.length < 4) continue;
                    const statusCode = line.substring(0, 2);
                    const filePath = line.substring(3);

                    let status = '??';
                    let staged = false;

                    if (statusCode[0] !== ' ' && statusCode[0] !== '?') {
                        staged = true;
                    }

                    if (statusCode.includes('M')) status = 'M';
                    else if (statusCode.includes('A')) status = 'A';
                    else if (statusCode.includes('D')) status = 'D';
                    else if (statusCode.includes('R')) status = 'R';
                    else if (statusCode.includes('C')) status = 'C';
                    else if (statusCode.includes('?')) status = '??';

                    files.push({
                        path: filePath,
                        status,
                        staged,
                    });
                }
            }

            return {
                isGitRepo: true,
                branch,
                files,
            };
        } catch {
            return {
                isGitRepo: false,
                files: [],
            };
        }
    }

    private async assertWorkspaceRootAccess(workspaceRoot: string | undefined, userId?: string | null): Promise<void> {
        if (!workspaceRoot?.trim()) {
            return;
        }
        await this.assertWorkspacePathAccess(workspaceRoot, userId);
    }

    private async assertWorkspacePathAccess(pathValue: string | undefined, userId?: string | null): Promise<void> {
        const target = this.normalizeAccessPath(pathValue);
        if (!target) {
            throw new BadRequestException('workspace path is required');
        }
        this.assertNoPathTraversal(target);
        return;
    }

    private assertRelativeFilePaths(filePaths?: string[]): void {
        if (!filePaths?.length) return;
        for (const filePath of filePaths) {
            const normalized = filePath.replace(/\\/g, '/').trim();
            const segments = normalized.split('/').filter(Boolean);
            if (
                !normalized ||
                normalized.startsWith('/') ||
                segments.some(segment => segment === '.' || segment === '..')
            ) {
                throw new BadRequestException('filePaths must be relative paths inside rootPath');
            }
        }
    }

    private normalizeAccessPath(pathValue: string | undefined): string {
        const normalized = (pathValue ?? '').trim().replace(/\\/g, '/');
        return normalized.replace(/([^:])\/{2,}/g, '$1/').replace(/\/+$/g, '');
    }

    private assertNoPathTraversal(pathValue: string): void {
        const segments = pathValue.split('/').filter(Boolean);
        if (segments.some(segment => segment === '.' || segment === '..')) {
            throw new BadRequestException('workspace path cannot contain traversal segments');
        }
    }

    private resolveUserId(userId?: string | null): string {
        return userId || 'desktop-user';
    }
}
