import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DESKTOP_PERMISSION, ResourceManagementApi } from '@/shared/security/desktop-access';
import { ApiOkResponse } from '@/shared/api/openapi';
import { NotFoundException } from '@/shared/common/errors';
import { LoopSpecRegistry } from '../application/loop-spec-registry';
import type { LoopSpec } from '../domain/services/loop-spec.interface';

/**
 * Read-only API for the loop ENGINEERING MODEL (循环工程建模): returns the declarative LoopSpec of each
 * existing kernel loop (dev / ops:reconcile / ops:deploy / knowledge:freshness / knowledge:curation),
 * including the honest enforced-vs-declaredOnly split. The 认知 / loop-engineering pages render these.
 *
 * Tagged with MENU_OBSERVABILITY_LIFECYCLE for desktop menu metadata.
 */
@ApiTags('循环工程 - 建模')
@ResourceManagementApi(DESKTOP_PERMISSION.MENU_OBSERVABILITY_LIFECYCLE)
@Controller('loops/specs')
export class LoopSpecController {
    constructor(private readonly registry: LoopSpecRegistry) {}

    @Get()
    @ApiOkResponse({
        summary: '循环工程建模列表(只读)',
        description:
            '返回每条内核循环的声明式建模(6 要素 + 字段),含「引擎是否真正强制」(enforced/declaredOnly)的诚实标注',
    })
    list(): LoopSpec[] {
        return this.registry.list();
    }

    @Get(':key')
    @ApiOkResponse({ summary: '单条循环建模', description: '按 key 返回单条循环的建模(只读)' })
    get(@Param('key') key: string): LoopSpec {
        const spec = this.registry.get(key);
        if (!spec) {
            throw new NotFoundException('循环建模未找到');
        }
        return spec;
    }
}
