/**
 * Agent Configuration Value Objects
 * 智能体资产的配置定义
 */

/**
 * 模型提供商类型
 */
export type ModelProvider = 'anthropic' | 'openai' | 'azure' | 'bedrock' | 'vertex' | 'custom';

/**
 * 模型配置
 */
export interface AgentModelConfig {
    provider: ModelProvider;
    modelId: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
    apiKey?: string;
    apiEndpoint?: string;
    apiVersion?: string;
}

/**
 * 工具配置
 */
export interface AgentToolConfig {
    id: string;
    name: string;
    type: 'function' | 'mcp' | 'api' | 'builtin';
    enabled: boolean;
    config?: Record<string, unknown>;
    description?: string;
}

/**
 * 技能配置
 */
export interface AgentSkillConfig {
    id: string;
    name: string;
    version?: string;
    enabled: boolean;
    config?: Record<string, unknown>;
}

/**
 * 知识库配置
 */
export interface AgentKnowledgeConfig {
    id: string;
    name: string;
    type: 'vector' | 'graph' | 'document';
    enabled: boolean;
    config?: Record<string, unknown>;
}

/**
 * 记忆配置
 */
export interface AgentMemoryConfig {
    enabled: boolean;
    type: 'short_term' | 'long_term' | 'episodic' | 'semantic';
    maxTokens?: number;
    persistenceStrategy?: 'session' | 'permanent';
    config?: Record<string, unknown>;
}

/**
 * 智能体人格配置
 */
export interface AgentPersonalityConfig {
    name?: string;
    role?: string;
    traits?: string[];
    communicationStyle?: string;
    expertise?: string[];
}

export interface AgentComponentRef {
    assetId?: string;
    category?: 'mcp' | 'knowledge' | 'memory' | 'skill' | 'tool' | 'workflow' | string;
    name?: string;
    version?: string;
    required?: boolean;
}

/**
 * 智能体完整配置
 */
export interface AgentConfig {
    systemPrompt: string;
    model: AgentModelConfig;
    tools?: AgentToolConfig[];
    skills?: AgentSkillConfig[];
    knowledge?: AgentKnowledgeConfig[];
    memory?: AgentMemoryConfig;
    personality?: AgentPersonalityConfig;
    maxIterations?: number;
    timeout?: number;
    enableThinking?: boolean;
    enableCaching?: boolean;
    runtimePolicy?: Record<string, unknown>;
    safetyPolicy?: Record<string, unknown>;
    componentRefs?: AgentComponentRef[];
}

/**
 * 验证智能体配置
 */
export function validateAgentConfig(config: unknown): config is AgentConfig {
    if (!config || typeof config !== 'object') {
        return false;
    }

    const c = config as Partial<AgentConfig>;

    // systemPrompt 和 model 是必需的
    if (!c.systemPrompt || typeof c.systemPrompt !== 'string') {
        return false;
    }

    if (!c.model || typeof c.model !== 'object') {
        return false;
    }

    const model = c.model as Partial<AgentModelConfig>;
    if (!model.provider || !model.modelId) {
        return false;
    }

    return true;
}

/**
 * 创建默认智能体配置
 */
export function createDefaultAgentConfig(): AgentConfig {
    return {
        systemPrompt: 'You are a helpful AI assistant.',
        model: {
            provider: 'anthropic',
            modelId: 'claude-opus-4-7',
            temperature: 1.0,
            maxTokens: 4096,
        },
        tools: [],
        skills: [],
        knowledge: [],
        memory: {
            enabled: true,
            type: 'short_term',
            persistenceStrategy: 'session',
        },
        maxIterations: 10,
        timeout: 300000,
        enableThinking: true,
        enableCaching: true,
    };
}
