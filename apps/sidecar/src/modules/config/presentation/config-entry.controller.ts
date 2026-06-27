import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Put, Query } from '@nestjs/common';
import { NotFoundException } from '@/shared/common/errors';
import { ApiTags } from '@nestjs/swagger';
import { PaginatedResponseDto, parsePageQueryOptions, toPaginatedResponse } from '@/shared/application/pagination.dto';
import { ApiNoContentResponse, ApiOkResponse, ApiPaginatedResponse } from '@/shared/api/openapi';
import {
    ConfigManagementApi,
    ConfigMutation,
    MANAGEMENT_ACTION,
    MANAGEMENT_RESOURCE,
} from '@/shared/security/desktop-access';
import { ConfigServiceImpl } from '../application/config.service';
import {
  ConfigEntryKeyQueryDto,
  ConfigEntryListQueryDto,
  ConfigEntryResponseDto,
  UpsertConfigEntryRequestDto,
} from './dto';

@ApiTags('系统 - 配置项')
@ConfigManagementApi()
@Controller('config/entries')
export class ConfigEntryController {
  constructor(private readonly configService: ConfigServiceImpl) {}

  @Get()
  @ApiPaginatedResponse({ summary: '获取配置项列表', description: '按 key 前缀检索配置项' })
  async listConfigEntries(@Query() query: ConfigEntryListQueryDto): Promise<PaginatedResponseDto<ConfigEntryResponseDto>> {
    const page = parsePageQueryOptions(query);
    const result = await this.configService.listConfigEntries({
      prefix: query.prefix || 'config/',
      search: page.search,
      sortBy: page.sortBy,
      sortOrder: page.sortOrder,
      limit: page.limit,
      offset: page.offset,
    });
    return toPaginatedResponse({
      items: result.items,
      total: result.total,
      page: page.page,
      limit: page.limit,
    });
  }

  @Get('value')
  @ApiOkResponse({ summary: '获取配置项', description: '按完整 key 获取配置项', type: ConfigEntryResponseDto })
  async getConfigEntry(@Query() query: ConfigEntryKeyQueryDto): Promise<ConfigEntryResponseDto> {
    const entry = await this.configService.getConfigEntry(query.key);
    if (!entry) {
      throw new NotFoundException('配置项不存在');
    }
    return entry;
  }

  @HttpCode(HttpStatus.OK)
  @Put()
  @ConfigMutation({
    action: MANAGEMENT_ACTION.UPSERT,
    resource: MANAGEMENT_RESOURCE.CONFIG_ENTRY,
    description: '保存配置项',
  })
  @ApiOkResponse({ summary: '保存配置项', description: '按完整 key 新增或更新配置项', type: ConfigEntryResponseDto })
  upsertConfigEntry(@Body() dto: UpsertConfigEntryRequestDto): Promise<ConfigEntryResponseDto> {
    return this.configService.upsertConfigEntry(dto.key, dto.value);
  }

  @Delete()
  @ConfigMutation({
    action: MANAGEMENT_ACTION.DELETE,
    resource: MANAGEMENT_RESOURCE.CONFIG_ENTRY,
    description: '删除配置项',
    requireReauth: true,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse('删除配置项')
  deleteConfigEntry(@Query() query: ConfigEntryKeyQueryDto): Promise<void> {
    return this.configService.deleteConfigEntry(query.key);
  }
}
