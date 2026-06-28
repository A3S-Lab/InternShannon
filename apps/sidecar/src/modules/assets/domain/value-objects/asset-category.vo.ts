/**
 * Asset Category - 数字资产分类
 */
export type AssetCategory =
    | 'code'        // 常规代码
    | 'agent'       // 智能体
    | 'mcp'          // MCP
    | 'knowledge'    // 知识库
    | 'memory'       // 记忆库
    | 'skill'        // 技能
    | 'tool'         // 工具
    | 'model';       // 模型

export const AssetCategory = {
    CODE: 'code' as AssetCategory,
    AGENT: 'agent' as AssetCategory,
    MCP: 'mcp' as AssetCategory,
    KNOWLEDGE: 'knowledge' as AssetCategory,
    MEMORY: 'memory' as AssetCategory,
    SKILL: 'skill' as AssetCategory,
    TOOL: 'tool' as AssetCategory,
    MODEL: 'model' as AssetCategory,
};

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
    code: '常规代码',
    agent: '智能体',
    mcp: 'MCP',
    knowledge: '知识库',
    memory: '记忆库',
    skill: '技能',
    tool: '工具',
    model: '模型',
};
