export interface AssetAssociatedAgentProfile {
    id?: string;
    name?: string;
}

export interface AssetComponentRefProfile {
    assetId?: string;
    category?: string;
    name?: string;
    version?: string;
    required?: boolean;
}

export interface AssetRuntimeMetricsProfile {
    callCount?: number;
    successRate?: number;
    averageLatencyMs?: number;
    resourceUsage?: string;
    tokenCount?: number;
    tokenCost?: number;
}

export interface AssetModelProfile {
    provider?: string;
    modelId?: string;
    contextWindow?: number;
    inputModalities?: string[];
    outputModalities?: string[];
    pricingTier?: string;
    capabilities?: string[];
    safetyPolicy?: Record<string, unknown>;
}

export interface AssetSkillProfile {
    runtime?: string;
    entrypoint?: string;
    supportedInputs?: string[];
    supportedOutputs?: string[];
    requiredPermissions?: string[];
    requiredSecrets?: string[];
    examples?: Array<Record<string, unknown>>;
}

export interface AssetToolProfile {
    serverType?: string;
    transport?: string;
    endpoint?: string;
    toolSchemas?: Array<Record<string, unknown>>;
    requiredSecrets?: string[];
    permissionScopes?: string[];
    safetyLevel?: string;
}

export interface AssetKnowledgeProfile {
    knowledgeType?: string;
    documentCount?: number;
    chunkCount?: number;
    indexStatus?: string;
    embeddingModel?: string;
    lastIndexedAt?: string;
}

export interface AssetMemoryProfile {
    memoryType?: string;
    scope?: string;
    retentionPolicy?: string;
    capacity?: number;
    itemCount?: number;
    lastCompactedAt?: string;
}

export interface AssetCatalogProfile {
    displayName?: string;
    summary?: string;
    tags?: string[];
    rating?: number;
    ratingCount?: number;
    downloadCount?: number;
    usageCount?: number;
    responseSpeed?: string;
    level?: string;
    status?: string;
    scenario?: string;
    knowledgeType?: string;
    memoryType?: string;
    qualityLevel?: string;
    qualityStatus?: string;
    riskLevel?: string;
    qualitySubmissionId?: string;
    evolutionStatus?: string;
    latestEvolutionJobId?: string;
    latestEvolutionTrigger?: string;
    latestEvolutionStrategy?: string;
    latestEvolutionTargetVersion?: string;
    latestEvolutionMetricDelta?: Record<string, unknown>;
    lastEvolvedAt?: string;
    ownerDisplayName?: string;
    lastValidatedAt?: string;
    componentRefs?: AssetComponentRefProfile[];
    associatedAgents?: AssetAssociatedAgentProfile[];
    metrics?: AssetRuntimeMetricsProfile;
    model?: AssetModelProfile;
    skill?: AssetSkillProfile;
    tool?: AssetToolProfile;
    knowledge?: AssetKnowledgeProfile;
    memory?: AssetMemoryProfile;
    updatedAt?: string;
}

export interface AssetCatalogProfileFilters {
    tags?: string[];
    level?: string;
    responseSpeed?: string;
    status?: string;
    scenario?: string;
    knowledgeType?: string;
    memoryType?: string;
    qualityLevel?: string;
    qualityStatus?: string;
    riskLevel?: string;
    evolutionStatus?: string;
    evolutionTrigger?: string;
    evolutionStrategy?: string;
    provider?: string;
    indexStatus?: string;
    minRating?: number;
}

export function mergeAssetCatalogProfileMetadata(
    metadata?: Record<string, unknown>,
    profile?: AssetCatalogProfile,
): Record<string, unknown> | undefined {
    if (!metadata && !profile) {
        return undefined;
    }

    const currentProfile = asRecord(metadata?.catalogProfile);
    const normalizedProfile = cleanObject({
        ...currentProfile,
        ...cleanObject(profile ?? {}),
    });

    return cleanObject({
        ...(metadata ?? {}),
        ...(Object.keys(normalizedProfile).length > 0 ? { catalogProfile: normalizedProfile } : {}),
    });
}

export function readAssetCatalogProfileFromAnnotations(
    fallbackName: string,
    annotations?: Record<string, string>,
): AssetCatalogProfile {
    return readAssetCatalogProfile(fallbackName, catalogMetadataFromAnnotations(annotations));
}

export function catalogMetadataFromAnnotations(annotations?: Record<string, string>): Record<string, unknown> {
    const metrics = cleanObject({
        callCount: numberValue(annotation(annotations, 'org.a3s.catalog.metrics.call-count')),
        successRate: numberValue(annotation(annotations, 'org.a3s.catalog.metrics.success-rate')),
        averageLatencyMs: numberValue(annotation(annotations, 'org.a3s.catalog.metrics.average-latency-ms')),
        resourceUsage: annotation(annotations, 'org.a3s.catalog.metrics.resource-usage'),
        tokenCount: numberValue(annotation(annotations, 'org.a3s.catalog.metrics.token-count')),
        tokenCost: numberValue(annotation(annotations, 'org.a3s.catalog.metrics.token-cost')),
    });
    const model = cleanObject({
        provider: annotation(annotations, 'org.a3s.catalog.model.provider'),
        modelId: annotation(annotations, 'org.a3s.catalog.model.id'),
        contextWindow: numberValue(annotation(annotations, 'org.a3s.catalog.model.context-window')),
        inputModalities: stringArray(annotation(annotations, 'org.a3s.catalog.model.input-modalities')),
        outputModalities: stringArray(annotation(annotations, 'org.a3s.catalog.model.output-modalities')),
        pricingTier: annotation(annotations, 'org.a3s.catalog.model.pricing-tier'),
        capabilities: stringArray(annotation(annotations, 'org.a3s.catalog.model.capabilities')),
    });
    const knowledge = cleanObject({
        knowledgeType: annotation(annotations, 'org.a3s.catalog.knowledge.type'),
        documentCount: numberValue(annotation(annotations, 'org.a3s.catalog.knowledge.document-count')),
        chunkCount: numberValue(annotation(annotations, 'org.a3s.catalog.knowledge.chunk-count')),
        indexStatus: annotation(annotations, 'org.a3s.catalog.knowledge.index-status'),
        embeddingModel: annotation(annotations, 'org.a3s.catalog.knowledge.embedding-model'),
        lastIndexedAt: annotation(annotations, 'org.a3s.catalog.knowledge.last-indexed-at'),
    });
    const memory = cleanObject({
        memoryType: annotation(annotations, 'org.a3s.catalog.memory.type'),
        scope: annotation(annotations, 'org.a3s.catalog.memory.scope'),
        retentionPolicy: annotation(annotations, 'org.a3s.catalog.memory.retention-policy'),
        capacity: numberValue(annotation(annotations, 'org.a3s.catalog.memory.capacity')),
        itemCount: numberValue(annotation(annotations, 'org.a3s.catalog.memory.item-count')),
        lastCompactedAt: annotation(annotations, 'org.a3s.catalog.memory.last-compacted-at'),
    });
    const catalogProfile = cleanObject({
        displayName: annotation(annotations, 'org.a3s.catalog.display-name') ?? annotation(annotations, 'org.opencontainers.image.title'),
        summary: annotation(annotations, 'org.a3s.catalog.summary') ?? annotation(annotations, 'org.opencontainers.image.description'),
        tags: stringArray(annotation(annotations, 'org.a3s.catalog.tags')),
        rating: numberValue(annotation(annotations, 'org.a3s.catalog.rating')),
        ratingCount: numberValue(annotation(annotations, 'org.a3s.catalog.rating-count')),
        downloadCount: numberValue(annotation(annotations, 'org.a3s.catalog.download-count')),
        usageCount: numberValue(annotation(annotations, 'org.a3s.catalog.usage-count')),
        responseSpeed: annotation(annotations, 'org.a3s.catalog.response-speed'),
        level: annotation(annotations, 'org.a3s.catalog.level'),
        status: annotation(annotations, 'org.a3s.catalog.status'),
        scenario: annotation(annotations, 'org.a3s.catalog.scenario'),
        knowledgeType: annotation(annotations, 'org.a3s.catalog.knowledge-type'),
        memoryType: annotation(annotations, 'org.a3s.catalog.memory-type'),
        qualityLevel: annotation(annotations, 'org.a3s.catalog.quality-level'),
        qualityStatus: annotation(annotations, 'org.a3s.catalog.quality-status'),
        riskLevel: annotation(annotations, 'org.a3s.catalog.risk-level'),
        qualitySubmissionId: annotation(annotations, 'org.a3s.catalog.quality-submission-id'),
        evolutionStatus: annotation(annotations, 'org.a3s.catalog.evolution-status'),
        latestEvolutionJobId: annotation(annotations, 'org.a3s.catalog.latest-evolution-job-id'),
        latestEvolutionTrigger: annotation(annotations, 'org.a3s.catalog.latest-evolution-trigger'),
        latestEvolutionStrategy: annotation(annotations, 'org.a3s.catalog.latest-evolution-strategy'),
        latestEvolutionTargetVersion: annotation(annotations, 'org.a3s.catalog.latest-evolution-target-version'),
        lastEvolvedAt: annotation(annotations, 'org.a3s.catalog.last-evolved-at'),
        ownerDisplayName: annotation(annotations, 'org.a3s.catalog.owner-display-name'),
        lastValidatedAt: annotation(annotations, 'org.a3s.catalog.last-validated-at'),
        model: Object.keys(model).length > 0 ? model : undefined,
        knowledge: Object.keys(knowledge).length > 0 ? knowledge : undefined,
        memory: Object.keys(memory).length > 0 ? memory : undefined,
        metrics: Object.keys(metrics).length > 0 ? metrics : undefined,
    });

    return cleanObject({
        catalogProfile: Object.keys(catalogProfile).length > 0 ? catalogProfile : undefined,
        displayName: annotation(annotations, 'org.opencontainers.image.title'),
        description: annotation(annotations, 'org.opencontainers.image.description'),
    });
}

export function matchesAssetCatalogProfile(
    profile: AssetCatalogProfile | undefined,
    filters: AssetCatalogProfileFilters,
): boolean {
    if (!profile) {
        return !hasAssetCatalogProfileFilters(filters);
    }
    if (filters.tags?.length) {
        const profileTags = new Set((profile.tags ?? []).map(tag => tag.toLowerCase()));
        if (!filters.tags.some(tag => profileTags.has(tag.toLowerCase()))) {
            return false;
        }
    }
    if (filters.level && profile.level !== filters.level) {
        return false;
    }
    if (filters.responseSpeed && profile.responseSpeed !== filters.responseSpeed) {
        return false;
    }
    if (filters.status && !matchesTextFilter(profile.status, filters.status)) {
        return false;
    }
    if (filters.scenario && !profile.scenario?.toLowerCase().includes(filters.scenario.toLowerCase())) {
        return false;
    }
    if (filters.knowledgeType && profile.knowledgeType !== filters.knowledgeType) {
        return false;
    }
    if (filters.memoryType && profile.memoryType !== filters.memoryType) {
        return false;
    }
    if (filters.qualityLevel && profile.qualityLevel !== filters.qualityLevel) {
        return false;
    }
    if (filters.qualityStatus && profile.qualityStatus !== filters.qualityStatus) {
        return false;
    }
    if (filters.riskLevel && profile.riskLevel !== filters.riskLevel) {
        return false;
    }
    if (filters.evolutionStatus && profile.evolutionStatus !== filters.evolutionStatus) {
        return false;
    }
    if (filters.evolutionTrigger && profile.latestEvolutionTrigger !== filters.evolutionTrigger) {
        return false;
    }
    if (filters.evolutionStrategy && profile.latestEvolutionStrategy !== filters.evolutionStrategy) {
        return false;
    }
    if (filters.provider && profile.model?.provider !== filters.provider) {
        return false;
    }
    if (filters.indexStatus && profile.knowledge?.indexStatus !== filters.indexStatus) {
        return false;
    }
    if (filters.minRating !== undefined && (profile.rating ?? 0) < filters.minRating) {
        return false;
    }
    return true;
}

export function hasAssetCatalogProfileFilters(filters: AssetCatalogProfileFilters): boolean {
    return Boolean(
        filters.tags?.length ||
        filters.level ||
        filters.responseSpeed ||
        filters.status ||
        filters.scenario ||
        filters.knowledgeType ||
        filters.memoryType ||
        filters.qualityLevel ||
        filters.qualityStatus ||
        filters.riskLevel ||
        filters.evolutionStatus ||
        filters.evolutionTrigger ||
        filters.evolutionStrategy ||
        filters.provider ||
        filters.indexStatus ||
        filters.minRating !== undefined
    );
}

export function readAssetCatalogProfile(
    fallbackName: string,
    metadata?: Record<string, unknown>,
): AssetCatalogProfile {
    const profile = asRecord(metadata?.catalogProfile);
    const metrics = asRecord(profile?.metrics) ?? asRecord(metadata?.metrics);
    const model = modelProfile(profile?.model ?? metadata?.model);
    const skill = skillProfile(profile?.skill ?? metadata?.skill);
    const tool = toolProfile(profile?.tool ?? metadata?.tool ?? metadata?.mcp);
    const knowledge = knowledgeProfile(profile?.knowledge ?? metadata?.knowledge);
    const memory = memoryProfile(profile?.memory ?? metadata?.memory);

    return cleanObject({
        displayName: stringValue(profile?.displayName) ?? stringValue(metadata?.displayName) ?? fallbackName,
        summary:
            stringValue(profile?.summary) ??
            stringValue(metadata?.summary) ??
            stringValue(metadata?.description),
        tags: stringArray(profile?.tags) ?? stringArray(metadata?.tags) ?? stringArray(metadata?.labels),
        rating: numberValue(profile?.rating) ?? numberValue(metadata?.rating),
        ratingCount: numberValue(profile?.ratingCount) ?? numberValue(metadata?.ratingCount),
        downloadCount: numberValue(profile?.downloadCount) ?? numberValue(metadata?.downloadCount),
        usageCount:
            numberValue(profile?.usageCount) ??
            numberValue(metadata?.usageCount) ??
            numberValue(metadata?.useCount),
        responseSpeed: stringValue(profile?.responseSpeed) ?? stringValue(metadata?.responseSpeed),
        level: stringValue(profile?.level) ?? stringValue(metadata?.level),
        status: stringValue(profile?.status) ?? stringValue(metadata?.status),
        scenario: stringValue(profile?.scenario) ?? stringValue(metadata?.scenario),
        knowledgeType:
            stringValue(profile?.knowledgeType) ??
            stringValue(metadata?.knowledgeType) ??
            knowledge?.knowledgeType,
        memoryType:
            stringValue(profile?.memoryType) ??
            stringValue(metadata?.memoryType) ??
            memory?.memoryType,
        qualityLevel: stringValue(profile?.qualityLevel) ?? stringValue(metadata?.qualityLevel),
        qualityStatus: stringValue(profile?.qualityStatus) ?? stringValue(metadata?.qualityStatus),
        riskLevel: stringValue(profile?.riskLevel) ?? stringValue(metadata?.riskLevel),
        qualitySubmissionId: stringValue(profile?.qualitySubmissionId) ?? stringValue(metadata?.qualitySubmissionId),
        evolutionStatus: stringValue(profile?.evolutionStatus) ?? stringValue(metadata?.evolutionStatus),
        latestEvolutionJobId: stringValue(profile?.latestEvolutionJobId) ?? stringValue(metadata?.latestEvolutionJobId),
        latestEvolutionTrigger: stringValue(profile?.latestEvolutionTrigger) ?? stringValue(metadata?.latestEvolutionTrigger),
        latestEvolutionStrategy: stringValue(profile?.latestEvolutionStrategy) ?? stringValue(metadata?.latestEvolutionStrategy),
        latestEvolutionTargetVersion:
            stringValue(profile?.latestEvolutionTargetVersion) ??
            stringValue(metadata?.latestEvolutionTargetVersion),
        latestEvolutionMetricDelta:
            asRecord(profile?.latestEvolutionMetricDelta) ??
            asRecord(metadata?.latestEvolutionMetricDelta),
        lastEvolvedAt: stringValue(profile?.lastEvolvedAt) ?? stringValue(metadata?.lastEvolvedAt),
        ownerDisplayName: stringValue(profile?.ownerDisplayName) ?? stringValue(metadata?.ownerDisplayName),
        lastValidatedAt: stringValue(profile?.lastValidatedAt) ?? stringValue(metadata?.lastValidatedAt),
        componentRefs: componentRefs(profile?.componentRefs ?? metadata?.componentRefs),
        associatedAgents: associatedAgents(profile?.associatedAgents ?? metadata?.associatedAgents),
        metrics: metrics ? cleanObject({
            callCount: numberValue(metrics.callCount),
            successRate: numberValue(metrics.successRate),
            averageLatencyMs: numberValue(metrics.averageLatencyMs),
            resourceUsage: stringValue(metrics.resourceUsage),
            tokenCount: numberValue(metrics.tokenCount),
            tokenCost: numberValue(metrics.tokenCost),
        }) : undefined,
        model,
        skill,
        tool,
        knowledge,
        memory,
        updatedAt: stringValue(profile?.updatedAt) ?? stringValue(metadata?.catalogProfileUpdatedAt),
    });
}

function annotation(annotations: Record<string, string> | undefined, key: string): string | undefined {
    return stringValue(annotations?.[key]);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function matchesTextFilter(value: string | undefined, filter: string): boolean {
    const normalized = filter.trim();
    if (!normalized) {
        return true;
    }
    if (normalized.startsWith('!')) {
        return value !== normalized.slice(1);
    }
    return value === normalized;
}

function numberValue(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
        return Number(value);
    }
    return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes'].includes(normalized)) {
            return true;
        }
        if (['false', '0', 'no'].includes(normalized)) {
            return false;
        }
    }
    return undefined;
}

function stringArray(value: unknown): string[] | undefined {
    if (Array.isArray(value)) {
        const values = value
            .filter((item): item is string => typeof item === 'string')
            .map(item => item.trim())
            .filter(Boolean);
        return values.length > 0 ? [...new Set(values)] : undefined;
    }
    if (typeof value === 'string') {
        const values = value.split(',').map(item => item.trim()).filter(Boolean);
        return values.length > 0 ? [...new Set(values)] : undefined;
    }
    return undefined;
}

function recordArray(value: unknown): Array<Record<string, unknown>> | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const values = value
        .map(item => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item));
    return values.length > 0 ? values : undefined;
}

function componentRefs(value: unknown): AssetComponentRefProfile[] | undefined {
    const items = recordArray(value)
        ?.map(item => cleanObject({
            assetId: stringValue(item.assetId) ?? stringValue(item.id),
            category: stringValue(item.category) ?? stringValue(item.type),
            name: stringValue(item.name),
            version: stringValue(item.version),
            required: booleanValue(item.required),
        }))
        .filter(item => item.assetId || item.name);
    return items?.length ? items : undefined;
}

function associatedAgents(value: unknown): AssetAssociatedAgentProfile[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const items = value
        .map(item => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map(item => cleanObject({
            id: stringValue(item.id),
            name: stringValue(item.name),
        }))
        .filter(item => item.id || item.name);
    return items.length > 0 ? items : undefined;
}

function modelProfile(value: unknown): AssetModelProfile | undefined {
    const item = asRecord(value);
    if (!item) {
        return undefined;
    }
    const profile = cleanObject({
        provider: stringValue(item.provider),
        modelId: stringValue(item.modelId) ?? stringValue(item.id),
        contextWindow: numberValue(item.contextWindow),
        inputModalities: stringArray(item.inputModalities),
        outputModalities: stringArray(item.outputModalities),
        pricingTier: stringValue(item.pricingTier),
        capabilities: stringArray(item.capabilities),
        safetyPolicy: asRecord(item.safetyPolicy),
    });
    return Object.keys(profile).length > 0 ? profile : undefined;
}

function skillProfile(value: unknown): AssetSkillProfile | undefined {
    const item = asRecord(value);
    if (!item) {
        return undefined;
    }
    const profile = cleanObject({
        runtime: stringValue(item.runtime),
        entrypoint: stringValue(item.entrypoint),
        supportedInputs: stringArray(item.supportedInputs),
        supportedOutputs: stringArray(item.supportedOutputs),
        requiredPermissions: stringArray(item.requiredPermissions),
        requiredSecrets: stringArray(item.requiredSecrets),
        examples: recordArray(item.examples),
    });
    return Object.keys(profile).length > 0 ? profile : undefined;
}

function toolProfile(value: unknown): AssetToolProfile | undefined {
    const item = asRecord(value);
    if (!item) {
        return undefined;
    }
    const profile = cleanObject({
        serverType: stringValue(item.serverType),
        transport: stringValue(item.transport),
        endpoint: stringValue(item.endpoint),
        toolSchemas: recordArray(item.toolSchemas),
        requiredSecrets: stringArray(item.requiredSecrets),
        permissionScopes: stringArray(item.permissionScopes),
        safetyLevel: stringValue(item.safetyLevel),
    });
    return Object.keys(profile).length > 0 ? profile : undefined;
}

function knowledgeProfile(value: unknown): AssetKnowledgeProfile | undefined {
    const item = asRecord(value);
    if (!item) {
        return undefined;
    }
    const profile = cleanObject({
        knowledgeType: stringValue(item.knowledgeType) ?? stringValue(item.type),
        documentCount: numberValue(item.documentCount),
        chunkCount: numberValue(item.chunkCount),
        indexStatus: stringValue(item.indexStatus),
        embeddingModel: stringValue(item.embeddingModel),
        lastIndexedAt: stringValue(item.lastIndexedAt),
    });
    return Object.keys(profile).length > 0 ? profile : undefined;
}

function memoryProfile(value: unknown): AssetMemoryProfile | undefined {
    const item = asRecord(value);
    if (!item) {
        return undefined;
    }
    const profile = cleanObject({
        memoryType: stringValue(item.memoryType) ?? stringValue(item.type),
        scope: stringValue(item.scope),
        retentionPolicy: stringValue(item.retentionPolicy),
        capacity: numberValue(item.capacity),
        itemCount: numberValue(item.itemCount),
        lastCompactedAt: stringValue(item.lastCompactedAt),
    });
    return Object.keys(profile).length > 0 ? profile : undefined;
}

function cleanObject<T extends object>(value: T): T {
    return Object.fromEntries(
        Object.entries(value).filter(([, item]) => item !== undefined),
    ) as T;
}
