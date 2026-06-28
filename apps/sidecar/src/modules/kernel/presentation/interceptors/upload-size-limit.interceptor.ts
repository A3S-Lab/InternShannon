// ============================================================================
// 运行时上传体积上限拦截器(从分布式配置中心实时读取)。
//
// 上传大小「策略上限」统一由平台配置(platform.uploadMax*Mb)决定,在「系统 → 平台配置 →
// 文件上传」页改完即生效(无需改 env / 重启)。本拦截器读取请求的 Content-Length 与该上限比对,
// 超限即提前拒绝(在 multer 把整个文件读进内存之前)。multer 自身的静态 limit 仅作绝对内存兜底。
//
// 注意:Content-Length 缺失(分块传输)时跳过本检查——此时由 multer 绝对兜底 + 服务层按实际
// 字节数(已解码 buffer / 分块声明 size)的精确强制兜住。
// ============================================================================

import {
    type CallHandler,
    type ExecutionContext,
    Inject,
    Injectable,
    mixin,
    type NestInterceptor,
    Optional,
    PayloadTooLargeException,
    type Type,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { CONFIG_SERVICE, ConfigService } from '@/modules/config/domain/services/config-service.interface';
import { DEFAULT_SETTINGS } from '@/modules/config/domain/services/settings-schema';

/** 平台配置里以 MB 表达的上传上限字段。 */
export type UploadSizeLimitKey = 'uploadMaxExcelMb' | 'uploadMaxWorkspaceFileMb';

/**
 * 生成一个按平台配置 `platform[limitKey]` 实时限制上传体积的拦截器。用在 FileInterceptor 之前:
 * `@UseInterceptors(UploadSizeLimit('uploadMaxExcelMb'), FileInterceptor('file', { limits: { fileSize: <绝对兜底> } }))`
 */
export function UploadSizeLimit(limitKey: UploadSizeLimitKey): Type<NestInterceptor> {
    @Injectable()
    class UploadSizeLimitMixin implements NestInterceptor {
        constructor(@Optional() @Inject(CONFIG_SERVICE) private readonly config?: ConfigService) {}

        async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
            const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
            const settings = await this.config?.getSettings();
            // 默认值只存在于配置中心 schema(DEFAULT_SETTINGS),代码里不再硬编码数字。
            const maxMb = settings?.platform[limitKey] ?? DEFAULT_SETTINGS.platform[limitKey] ?? 0;
            const contentLength = Number(request.headers['content-length'] ?? 0);
            if (maxMb > 0 && Number.isFinite(contentLength) && contentLength > maxMb * 1024 * 1024) {
                throw new PayloadTooLargeException(`上传内容超过上限 ${maxMb}MB`);
            }
            return next.handle();
        }
    }
    return mixin(UploadSizeLimitMixin);
}
