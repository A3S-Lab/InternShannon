/**
 * Skill Configuration Value Objects
 * 技能资产的配置定义
 */

/**
 * 技能类型
 */
export type SkillType = 'command' | 'template' | 'function';

/**
 * 技能参数定义
 */
export interface SkillParameter {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    description?: string;
    required?: boolean;
    defaultValue?: unknown;
    enum?: unknown[];
}

/**
 * 技能配置
 */
export interface SkillConfig {
    type: SkillType;
    entrypoint: string;
    parameters?: SkillParameter[];
    dependencies?: string[];
    runtime?: string;
    timeout?: number;
    description?: string;
}

/**
 * 验证技能配置
 */
export function validateSkillConfig(config: unknown): config is SkillConfig {
    if (!config || typeof config !== 'object') {
        return false;
    }

    const c = config as Partial<SkillConfig>;

    if (!c.type || !c.entrypoint) {
        return false;
    }

    const validTypes: SkillType[] = ['command', 'template', 'function'];
    if (!validTypes.includes(c.type as SkillType)) {
        return false;
    }

    return true;
}

/**
 * 创建默认技能配置
 */
export function createDefaultSkillConfig(): SkillConfig {
    return {
        type: 'command',
        entrypoint: 'main.sh',
        parameters: [],
        dependencies: [],
        timeout: 60000,
    };
}
