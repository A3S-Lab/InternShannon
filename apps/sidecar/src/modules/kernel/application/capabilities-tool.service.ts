import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { ASSET_SERVICE, type IAssetService } from '@/modules/assets/domain/services/asset.service.interface';
import type { ApiModule, ApiOperation } from '../domain/services/api-explorer.interface';
import { IKernelService, KERNEL_SERVICE } from '../domain/services/kernel-service.interface';
import { LockedAgentSessionStore } from './agents/locked-agent-session.store';

export type CapabilityAction = 'list' | 'describe' | 'search' | 'execute';

export interface CapabilityRequest {
    action?: CapabilityAction;
    module?: string;
    query?: string;
    operation?: string;
    params?: Record<string, unknown>;
    sessionId?: string;
}

export type CapabilityResult =
    | ApiModule[]
    | ApiModule
    | ApiOperation[]
    | Record<string, unknown>
    | unknown[]
    | string
    | number
    | boolean
    | null;

export interface CapabilitiesTool {
    name: 'capabilities';
    description: 'Discover and explore OS capabilities (APIs) available to the agent';
    input_schema: {
        type: 'object';
        properties: {
            action: {
                type: 'string';
                enum: ['list', 'search', 'describe', 'execute'];
                description: 'Action to perform';
            };
            module?: {
                type: 'string';
                description: 'Module name (used by the describe action)';
            };
            query?: {
                type: 'string';
                description: 'Search keywords (used by the search action)';
            };
            operation?: {
                type: 'string';
                description: 'Operation name (used by execute)';
            };
            params?: {
                type: 'object';
                description: 'Operation parameters (used by execute)';
            };
            sessionId?: {
                type: 'string';
                description: 'Kernel session id for built-in agent asset locking';
            };
        };
        required: ['action'];
    };
}

const A3S_CODE_AGENT_SCAFFOLD_TEMPLATES = new Set([
    'a3s-code-basic-agent',
    'a3s-code-tool-agent',
    'a3s-code-python-basic-agent',
    'a3s-code-python-tool-agent',
]);

@Injectable()
export class CapabilitiesToolService {
    constructor(
        @Inject(KERNEL_SERVICE)
        private readonly kernelService: IKernelService,
        @Optional()
        @Inject(ASSET_SERVICE)
        private readonly assetService?: IAssetService,
        @Optional()
        private readonly lockedAgentSessions?: LockedAgentSessionStore,
    ) {}

    /**
     * Single dispatch entry-point shared by the HTTP controller and any in-process callers.
     * Throws on invalid input so the caller can map to the appropriate transport error.
     */
    async dispatch(input: CapabilityRequest, userId: string): Promise<CapabilityResult> {
        const action: CapabilityAction = input.action || 'list';

        switch (action) {
            case 'list':
                return this.kernelService.listModules(userId);

            case 'describe': {
                const moduleName = input.module ?? input.query;
                if (!moduleName) {
                    throw new Error('module parameter is required for describe action');
                }
                return this.kernelService.getModule(moduleName, userId);
            }

            case 'search':
                if (!input.query) {
                    throw new Error('query parameter is required for search action');
                }
                return this.kernelService.searchOperations(input.query, userId);

            case 'execute': {
                const moduleName = input.module ?? input.query;
                const operationName = input.operation;
                if (!moduleName) {
                    throw new Error('module parameter is required for execute action');
                }
                if (!operationName) {
                    throw new Error('operation parameter is required for execute action');
                }
                const operation = await this.resolveOperation(moduleName, operationName, userId);
                this.normalizeAssetCreateName(input, operation);
                await this.applyAssetAgentCategoryHint(input, operation);
                await this.applyBuiltInAssetAgentDefaults(input, operation);
                await this.assertSingleAssetSessionCanExecute(input, operation, userId);
                await this.assertBuiltInAgentAssetFramework(input, operation);
                await this.assertConversationalAgentReadOnly(input, operation);
                const result = await this.kernelService.executeOperation(
                    moduleName,
                    operationName,
                    input.params ?? {},
                    userId,
                );
                await this.bindSingleAssetSessionAfterExecute(input, operation, result);
                return this.unwrapOperationResult(result);
            }

            default:
                throw new Error(`Unknown action: ${action}`);
        }
    }

    /**
     * 对话创建资产的命名兜底:prompt 已要求 kebab-case,但模型偶发直接用中文当 name。
     * 这里把非法 name 统一 slug 化(与工作流资产同款小写 kebab 命名);原始中文名挪进
     * catalogProfile.displayName(不覆盖已有),展示名不丢失。
     */
    private normalizeAssetCreateName(input: CapabilityRequest, operation: ApiOperation): void {
        if (!this.isRootAssetCreate(operation)) return;
        if ((input.module ?? input.query ?? '').toLowerCase() !== 'assets') return;
        const params = input.params ?? {};
        const rawName = this.stringValue(params.name);
        if (!rawName || /^[a-z0-9][a-z0-9-]*$/.test(rawName)) return;

        const slug = rawName
            .toLowerCase()
            .replace(/[\s_]+/g, '-')
            .replace(/[^a-z0-9-]+/g, '')
            .replace(/-{2,}/g, '-')
            .replace(/^-+|-+$/g, '');
        // 纯中文等 slug 化后为空/过短:按类别兜底 + 时间戳尾缀防撞名。
        const fallback = `${this.stringValue(params.category) || 'asset'}-${Date.now().toString(36).slice(-5)}`;
        params.name = slug.length >= 3 ? slug : fallback;

        const profile =
            params.catalogProfile && typeof params.catalogProfile === 'object'
                ? (params.catalogProfile as Record<string, unknown>)
                : {};
        if (!this.stringValue(profile.displayName)) {
            profile.displayName = rawName;
        }
        params.catalogProfile = profile;
        input.params = params;
    }

    /**
     * Pin createAsset to the category the user picked in the create dialog
     * (session.metadata.assetCategory). Auto-fills it when the model omitted
     * the field, and rejects mismatches so a "create a tool" dialog can't
     * produce a knowledge asset instead.
     */
    private async applyAssetAgentCategoryHint(input: CapabilityRequest, operation: ApiOperation): Promise<void> {
        if (!input.sessionId || !this.isRootAssetCreate(operation)) return;
        const moduleName = (input.module ?? input.query ?? '').toLowerCase();
        if (moduleName !== 'assets') return;

        const session = await this.kernelService.getSession(input.sessionId);
        if (session?.agentId !== 'asset') return;

        const hint = this.stringValue(session.metadata?.assetCategory);
        if (!hint) return;
        // Once an asset is bound, the single-asset-lock path takes over.
        if (this.stringValue(session.metadata?.assetId)) return;

        const params = input.params ?? {};
        const requested = this.stringValue(params.category);
        if (!requested) {
            params.category = hint;
            input.params = params;
            return;
        }
        if (requested !== hint) {
            throw new BadRequestException(
                `当前会话设定的目标资产类型是 ${hint}，不能创建 ${requested} 类型的资产。如需切换类型，请开启新会话。`,
            );
        }
    }

    private async applyBuiltInAssetAgentDefaults(input: CapabilityRequest, operation: ApiOperation): Promise<void> {
        if (!input.sessionId || !this.isRootAssetCreate(operation)) return;
        const moduleName = (input.module ?? input.query ?? '').toLowerCase();
        if (moduleName !== 'assets') return;

        const session = await this.kernelService.getSession(input.sessionId);
        if (session?.agentId !== 'asset') return;

        const params = input.params ?? {};
        if (params.category !== 'agent') return;

        const scaffoldTemplate = this.stringValue(params.scaffoldTemplate);
        if (!scaffoldTemplate) {
            params.scaffoldTemplate = 'a3s-code-basic-agent';
            input.params = params;
            return;
        }

        if (!A3S_CODE_AGENT_SCAFFOLD_TEMPLATES.has(scaffoldTemplate)) {
            this.throwA3sCodeScaffoldRequired();
        }
    }

    private async assertBuiltInAgentAssetFramework(input: CapabilityRequest, operation: ApiOperation): Promise<void> {
        if (!input.sessionId || !this.isAssetWriteOperation(input, operation) || this.isRootAssetCreate(operation))
            return;

        const session = await this.kernelService.getSession(input.sessionId);
        if (session?.agentId !== 'asset') return;

        const targetAssetId = this.extractTargetAssetId(operation, input.params ?? {});
        const assetCategory = await this.resolveTargetAssetCategory(session.metadata, targetAssetId);
        if (assetCategory !== 'agent') return;

        if (this.isRepositoryScaffoldOperation(operation)) {
            this.assertA3sCodeScaffoldTemplate(this.stringValue(input.params?.templateKey));
            return;
        }

        if (this.isRepositoryFilesUploadOperation(operation)) {
            this.assertUploadedAgentRepositoryUsesA3sCode(input.params);
            return;
        }

        if (this.isBlobUpdateOperation(operation)) {
            this.assertCriticalAgentBlobUsesA3sCode(input.params ?? {});
        }
    }

    /**
     * Tool-shaped wrapper that returns a structured payload (success flag + data)
     * suitable for direct rendering into a tool-result message.
     */
    async execute(input: CapabilityRequest, userId: string): Promise<Record<string, unknown>> {
        try {
            const result = await this.dispatch(input, userId);
            return this.shapeToolResult(input.action || 'list', input, result);
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    private shapeToolResult(
        action: CapabilityAction,
        input: CapabilityRequest,
        result: CapabilityResult,
    ): Record<string, unknown> {
        switch (action) {
            case 'list': {
                const modules = (result as ApiModule[]) ?? [];
                return {
                    success: true,
                    modules: modules.map(m => ({
                        name: m.name,
                        description: m.description,
                        path: m.path,
                        operationCount:
                            (m.operations?.length || 0) +
                            (m.submodules?.reduce((sum, sub) => sum + (sub.operations?.length || 0), 0) || 0),
                    })),
                };
            }

            case 'search': {
                const operations = (result as ApiOperation[]) ?? [];
                return {
                    success: true,
                    query: input.query,
                    results: operations.map(op => ({
                        name: op.name,
                        description: op.description,
                        method: op.method,
                        path: op.path,
                        resource: op.resource,
                        action: op.action,
                        pagination: op.pagination,
                        filterFields: op.filterFields,
                        sortFields: op.sortFields,
                    })),
                };
            }

            case 'describe': {
                const moduleResult = result as ApiModule | null;
                if (!moduleResult) {
                    return {
                        success: false,
                        error: `Module '${input.module ?? input.query}' not found or access denied`,
                    };
                }
                return {
                    success: true,
                    module: {
                        name: moduleResult.name,
                        description: moduleResult.description,
                        path: moduleResult.path,
                        operations: moduleResult.operations?.map(op => ({
                            name: op.name,
                            description: op.description,
                            method: op.method,
                            path: op.path,
                            resource: op.resource,
                            action: op.action,
                            parameters: op.parameters,
                            inputSchema: op.inputSchema,
                            outputSchema: op.outputSchema,
                            pagination: op.pagination,
                            filterFields: op.filterFields,
                            sortFields: op.sortFields,
                            relatedOperations: op.relatedOperations,
                        })),
                        submodules: moduleResult.submodules?.map(sub => ({
                            name: sub.name,
                            description: sub.description,
                            operationCount: sub.operations?.length || 0,
                        })),
                    },
                };
            }

            case 'execute':
                return {
                    success: true,
                    module: input.module ?? input.query,
                    operation: input.operation,
                    data: result,
                };
        }
    }

    private async resolveOperation(moduleName: string, operationName: string, userId: string): Promise<ApiOperation> {
        const module = await this.kernelService.getModule(moduleName, userId);
        const operation = this.findOperation(module, operationName);
        if (!operation) {
            throw new Error(`Operation '${operationName}' not found in module '${moduleName}'`);
        }
        return operation;
    }

    private findOperation(module: ApiModule | null, operationName: string): ApiOperation | null {
        if (!module) return null;
        const direct = module.operations?.find(op => op.name === operationName || op.operationId === operationName);
        if (direct) return direct;
        for (const sub of module.submodules ?? []) {
            const nested = this.findOperation(sub, operationName);
            if (nested) return nested;
        }
        return null;
    }

    private async assertSingleAssetSessionCanExecute(
        input: CapabilityRequest,
        operation: ApiOperation,
        _userId: string,
    ): Promise<void> {
        if (!input.sessionId) return;
        if (!this.isWriteMethod(operation)) return;

        const session = await this.kernelService.getSession(input.sessionId);
        if (!session || !this.isSingleAssetAgent(session.agentId)) return;

        const moduleName = (input.module ?? input.query ?? '').toLowerCase();

        // Locked agents (orchestration / asset) are scoped to a single
        // digital asset. They are explicitly NOT allowed to issue writes
        // against other platform modules (packages, registry, runtime,
        // resources, observability, marketplace, etc.) — even if the
        // calling user happens to hold the matching permission. This
        // closes the prompt-injection abuse path where a model could be
        // coerced into publishing a package, deploying a runtime, or
        // mutating resources unrelated to the bound asset.
        if (moduleName !== 'assets') {
            throw new BadRequestException(
                `内置智能体（${session.agentId}）会话仅允许通过 capabilities 对 assets 模块执行写操作；当前请求目标模块为 "${moduleName || 'unknown'}"，已被拒绝。如需进行该操作，请由用户在对应界面手动触发。`,
            );
        }

        const lockedAssetId = this.stringValue(session.metadata?.assetId);
        const targetAssetId = this.extractTargetAssetId(operation, input.params ?? {});

        if (this.isRootAssetCreate(operation)) {
            if (lockedAssetId) {
                throw new BadRequestException(
                    `当前会话已经绑定数字资产 ${lockedAssetId}，不能在同一会话中创建第二个资产。请开启新会话创建其他资产。`,
                );
            }
            this.assertAssetProposalConfirmed(input.sessionId, session.agentId);
            return;
        }

        if (this.isAssetForkOperation(operation)) {
            throw new BadRequestException('当前内置智能体会话只能绑定一个数字资产，不能在会话内 fork 出第二个资产。');
        }

        if (!targetAssetId) {
            throw new BadRequestException('当前内置智能体会话的资产写操作必须携带目标资产 id，以便校验单资产会话锁。');
        }

        if (lockedAssetId && targetAssetId !== lockedAssetId) {
            throw new BadRequestException(
                `当前会话已经绑定数字资产 ${lockedAssetId}，不能修改其他资产 ${targetAssetId}。`,
            );
        }

        if (!lockedAssetId) {
            await this.bindSessionAsset(input.sessionId, targetAssetId);
        }
    }

    /**
     * 默认会话助手(internShannon,agentId='default')以【只读】方式使用渐进式 API:它经
     * runtimeDefaults().allowCapabilities 被放行 capabilities,但 execute 仅允许 GET 只读
     * 操作 —— 拒绝写 / 删,以中和「恶意知识文档或用户输入诱导对话助手执行用户本有权限的
     * 破坏性写操作」的提示注入面。锁定型 agent(asset / orchestration)各有 assets 单资产
     * 写门禁(见 assertSingleAssetSessionCanExecute),不走此分支;无 sessionId 的直连调用
     * 由调用者自身权限把关,亦不受此限。
     */
    private async assertConversationalAgentReadOnly(input: CapabilityRequest, operation: ApiOperation): Promise<void> {
        if (!input.sessionId || !this.isWriteMethod(operation)) return;
        const session = await this.kernelService.getSession(input.sessionId);
        if (session?.agentId === 'default') {
            throw new BadRequestException(
                'internShannon(对话助手)通过渐进式 API 仅可执行只读(查询)操作;写入 / 删除请在对应产品界面手动完成。',
            );
        }
    }

    private async bindSingleAssetSessionAfterExecute(
        input: CapabilityRequest,
        operation: ApiOperation,
        result: unknown,
    ): Promise<void> {
        if (!input.sessionId || !this.isRootAssetCreate(operation)) return;
        const session = await this.kernelService.getSession(input.sessionId);
        if (!session || !this.isSingleAssetAgent(session.agentId) || this.stringValue(session.metadata?.assetId))
            return;

        const assetId = this.extractAssetIdFromResult(result);
        if (assetId) {
            await this.bindSessionAsset(input.sessionId, assetId, result);
        }
    }

    private async bindSessionAsset(sessionId: string, assetId: string, result?: unknown): Promise<void> {
        const asset = this.extractAssetMetadataFromResult(result);
        await this.kernelService.updateSession(sessionId, {
            assetId,
            ...(asset.name ? { assetName: asset.name } : {}),
            ...(asset.category ? { assetCategory: asset.category } : {}),
            ...(asset.visibility ? { assetVisibility: asset.visibility } : {}),
            singleAssetSession: true,
        });
    }

    /**
     * Hard gate the open-platform asset agent: the LLM must first emit an
     * `\`\`\`asset-proposal` block AND see at least one user reply before
     * `createAsset` is allowed. This is the runtime backstop for the prompt-
     * level requirement in `asset-agent.prompts.ts` so a non-compliant model
     * cannot silently fabricate an asset behind the user's back.
     *
     * Only fires for `agentId === 'asset'`. Orchestration agent has its own
     * flow (workflow asset is auto-created on session start) so it bypasses
     * the gate.
     *
     * No-ops when the LockedAgentSessionStore isn't wired (test envs, library
     * usage). The store is `@Optional` to keep this guard fail-open at module
     * boundaries; tighten via deployment config if you want the strict mode.
     */
    private assertAssetProposalConfirmed(sessionId: string, agentId: string | undefined): void {
        if (agentId !== 'asset') return;
        if (!this.lockedAgentSessions) return;
        const entry = this.lockedAgentSessions.get(sessionId);
        if (!entry?.asset) return;
        if (!entry.asset.lastProposal) {
            throw new BadRequestException(
                '创建资产前必须先用 ```asset-proposal``` 围栏块向用户展示方案；用户回话确认后才能调用 createAsset。',
            );
        }
        if (!entry.asset.proposalConfirmed) {
            throw new BadRequestException(
                '上一份 asset-proposal 还没收到用户回话，不能调用 createAsset。请等待用户确认或修改。',
            );
        }
    }

    private isAssetWriteOperation(input: CapabilityRequest, operation: ApiOperation): boolean {
        const moduleName = (input.module ?? input.query ?? '').toLowerCase();
        return moduleName === 'assets' && this.isWriteMethod(operation);
    }

    private isWriteMethod(operation: ApiOperation): boolean {
        return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(operation.method);
    }

    private isSingleAssetAgent(agentId?: string): boolean {
        return agentId === 'asset' || agentId === 'orchestration';
    }

    private isRootAssetCreate(operation: ApiOperation): boolean {
        const normalizedPath = this.normalizePath(operation.path);
        return operation.method === 'POST' && /^\/api\/assets\/?$/.test(normalizedPath);
    }

    private isRepositoryScaffoldOperation(operation: ApiOperation): boolean {
        const normalizedPath = this.normalizePath(operation.path);
        return operation.method === 'POST' && /\/repository\/scaffold\/?$/.test(normalizedPath);
    }

    private isRepositoryFilesUploadOperation(operation: ApiOperation): boolean {
        const normalizedPath = this.normalizePath(operation.path);
        return operation.method === 'POST' && /\/repository\/files\/?$/.test(normalizedPath);
    }

    private isBlobUpdateOperation(operation: ApiOperation): boolean {
        const normalizedPath = this.normalizePath(operation.path);
        return operation.method === 'POST' && /\/blobs\/.+\/update\/?$/.test(normalizedPath);
    }

    private isAssetForkOperation(operation: ApiOperation): boolean {
        return /fork/i.test(operation.name) || /\/forks?(\/|$)/i.test(operation.path);
    }

    private extractTargetAssetId(operation: ApiOperation, params: Record<string, unknown>): string | undefined {
        const preferredKeys = ['assetId', 'id', ':assetId', ':id'];
        for (const key of preferredKeys) {
            const value = this.stringValue(params[key]);
            if (value) return value;
        }

        const pathParamNames =
            operation.parameters
                ?.filter(param => param.in === 'path')
                .map(param => param.name)
                .filter(name => /asset|^id$/i.test(name)) ?? [];
        for (const name of pathParamNames) {
            const value = this.stringValue(params[name]) ?? this.stringValue(params[`:${name}`]);
            if (value) return value;
        }

        return undefined;
    }

    private async resolveTargetAssetCategory(
        sessionMetadata: Record<string, unknown> | undefined,
        targetAssetId?: string,
    ): Promise<string | undefined> {
        if (!targetAssetId || !this.assetService) {
            return this.stringValue(sessionMetadata?.assetCategory);
        }
        const asset = await this.assetService.getAsset(targetAssetId).catch(() => null);
        return asset?.category ?? this.stringValue(sessionMetadata?.assetCategory);
    }

    private assertA3sCodeScaffoldTemplate(templateKey?: string): void {
        if (!templateKey || !A3S_CODE_AGENT_SCAFFOLD_TEMPLATES.has(templateKey)) {
            this.throwA3sCodeScaffoldRequired();
        }
    }

    private assertUploadedAgentRepositoryUsesA3sCode(params?: Record<string, unknown>): void {
        const files = Array.isArray(params?.files) ? params.files : [];
        const byPath = new Map<string, string | undefined>();
        for (const item of files) {
            if (!item || typeof item !== 'object') continue;
            const record = item as Record<string, unknown>;
            const filePath = this.normalizeRepositoryPath(this.stringValue(record.path));
            if (!filePath) continue;
            byPath.set(filePath, this.decodeBase64Text(this.stringValue(record.contentBase64)));
        }

        const agentJson = byPath.get('.a3s/agent.json');
        const agentAcl = byPath.get('.a3s/agent.acl');
        const packageJson = byPath.get('package.json');
        const pyproject = byPath.get('pyproject.toml');

        if (!agentJson || !agentAcl || (!packageJson && !pyproject)) {
            throw new BadRequestException(
                '开发智能体上传智能体资产仓库时必须包含 a3s-code 结构：.a3s/agent.json、.a3s/agent.acl，以及 package.json 或 pyproject.toml。',
            );
        }

        this.assertAgentJsonUsesA3sCode(agentJson);
        if (packageJson) this.assertPackageJsonUsesA3sCode(packageJson);
        if (pyproject) this.assertPyprojectUsesA3sCode(pyproject);
    }

    private assertCriticalAgentBlobUsesA3sCode(params: Record<string, unknown>): void {
        const filePath = this.normalizeRepositoryPath(
            this.stringValue(params.path) ?? this.stringValue(params.filePath) ?? this.stringValue(params[':path']),
        );
        if (!filePath) return;

        const content = this.stringValue(params.content);
        if (content == null) return;

        if (filePath === '.a3s/agent.json') {
            this.assertAgentJsonUsesA3sCode(content);
            return;
        }

        if (filePath === 'package.json') {
            this.assertPackageJsonUsesA3sCode(content);
            return;
        }

        if (filePath === 'pyproject.toml') {
            this.assertPyprojectUsesA3sCode(content);
        }
    }

    private assertAgentJsonUsesA3sCode(content: string): void {
        const parsed = this.parseJsonObject(content, '.a3s/agent.json');
        if (parsed.category !== 'agent' || parsed.framework !== 'a3s-code') {
            throw new BadRequestException(
                '智能体资产的 .a3s/agent.json 必须声明 {"category":"agent","framework":"a3s-code"}。',
            );
        }
    }

    private assertPackageJsonUsesA3sCode(content: string): void {
        const parsed = this.parseJsonObject(content, 'package.json');
        const dependencies = [
            parsed.dependencies,
            parsed.devDependencies,
            parsed.peerDependencies,
            parsed.optionalDependencies,
        ].filter(
            (value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value),
        );
        if (!dependencies.some(deps => typeof deps['@a3s-lab/code'] === 'string')) {
            throw new BadRequestException('TypeScript 智能体资产的 package.json 必须依赖 @a3s-lab/code。');
        }
    }

    private assertPyprojectUsesA3sCode(content: string): void {
        if (!/(^|["'\s])a3s-code([<>=~!,"\]\s]|$)/m.test(content)) {
            throw new BadRequestException('Python 智能体资产的 pyproject.toml 必须依赖 a3s-code。');
        }
    }

    private parseJsonObject(content: string, label: string): Record<string, unknown> {
        try {
            const parsed = JSON.parse(content);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            // Convert parser failures into product-facing validation errors below.
        }
        throw new BadRequestException(`${label} 必须是合法 JSON 对象。`);
    }

    private normalizeRepositoryPath(value?: string): string | undefined {
        const normalized = value?.trim().replace(/\\/g, '/').replace(/^\/+/, '');
        return normalized || undefined;
    }

    private decodeBase64Text(value?: string): string | undefined {
        if (!value) return undefined;
        try {
            return Buffer.from(value, 'base64').toString('utf8');
        } catch {
            return undefined;
        }
    }

    private throwA3sCodeScaffoldRequired(): never {
        throw new BadRequestException(
            '开发智能体创建或初始化智能体数字资产时必须使用 a3s-code 脚手架模板，例如 a3s-code-basic-agent。',
        );
    }

    private extractAssetIdFromResult(result: unknown): string | undefined {
        const data = this.unwrapOperationResult(result);
        if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
        const record = data as Record<string, unknown>;
        return this.stringValue(record.id) ?? this.stringValue(record.assetId);
    }

    private extractAssetMetadataFromResult(result: unknown): {
        name?: string;
        category?: string;
        visibility?: string;
        agentKind?: string;
    } {
        const data = this.unwrapOperationResult(result);
        if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
        const record = data as Record<string, unknown>;
        return {
            ...(this.stringValue(record.name) ? { name: this.stringValue(record.name) } : {}),
            ...(this.stringValue(record.category) ? { category: this.stringValue(record.category) } : {}),
            ...(this.stringValue(record.visibility) ? { visibility: this.stringValue(record.visibility) } : {}),
            ...(this.stringValue(record.agentKind) ? { agentKind: this.stringValue(record.agentKind) } : {}),
        };
    }

    private unwrapOperationResult(result: unknown): CapabilityResult {
        if (result == null) return null;
        if (typeof result !== 'object' || Array.isArray(result)) return result as CapabilityResult;
        const record = result as Record<string, unknown>;
        if ('data' in record && (('code' in record && 'message' in record) || '_meta' in record)) {
            return record.data as CapabilityResult;
        }
        return result as CapabilityResult;
    }

    private normalizePath(path: string): string {
        return path.startsWith('/') ? path : `/${path}`;
    }

    private stringValue(value: unknown): string | undefined {
        return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    }
}
