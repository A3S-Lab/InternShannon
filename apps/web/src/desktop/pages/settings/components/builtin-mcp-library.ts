// 官方 MCP 服务器精选库 —— 让用户「从官方库导入」一键预填表单,免去手写 transport/command/args。
// 数据镜像自后端 registry seed(builtin-mcp-packages.ts);这里只取 stdio 启动的官方/参考实现,
// 供桌面 MCP 配置表单的「导入」下拉用。新增官方包时两边一起更新即可(列表稳定、低频)。

export interface BuiltinMcpLibraryItem {
  /** 下拉项的稳定 key。 */
  key: string;
  /** 展示名。 */
  title: string;
  /** 一句话说明,展示在选项副标题。 */
  description: string;
  /** 建议的默认实例名(用户可改)。 */
  suggestedName: string;
  command: string;
  args: string[];
  /** 需要用户填值的环境变量名(预填到 env 输入,值留空让用户补)。 */
  env?: string[];
  /** 稳定度标记,纯展示。 */
  stability: "official" | "reference" | "archived-reference";
}

export const BUILTIN_MCP_LIBRARY: BuiltinMcpLibraryItem[] = [
  {
    key: "filesystem",
    title: "Filesystem",
    description: "受控的文件读写、目录管理、搜索与元数据。",
    suggestedName: "filesystem",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
    stability: "reference",
  },
  {
    key: "memory",
    title: "Memory（知识图谱）",
    description: "基于知识图谱的持久记忆,记录实体、关系与长期上下文。",
    suggestedName: "memory",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    stability: "reference",
  },
  {
    key: "sequential-thinking",
    title: "Sequential Thinking",
    description: "结构化分步推理,帮助模型拆解复杂问题。",
    suggestedName: "sequential-thinking",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    stability: "reference",
  },
  {
    key: "git",
    title: "Git",
    description: "对工作区 Git 仓库的状态、diff、提交历史查询。",
    suggestedName: "git",
    command: "uvx",
    args: ["mcp-server-git", "--repository", "/workspace"],
    stability: "reference",
  },
  {
    key: "fetch",
    title: "Fetch（网页抓取）",
    description: "抓取网页并转为适合模型阅读的内容。",
    suggestedName: "fetch",
    command: "uvx",
    args: ["mcp-server-fetch"],
    stability: "reference",
  },
  {
    key: "time",
    title: "Time（时间/时区）",
    description: "当前时间与时区换算。",
    suggestedName: "time",
    command: "uvx",
    args: ["mcp-server-time", "--local-timezone", "Asia/Shanghai"],
    stability: "reference",
  },
  {
    key: "github",
    title: "GitHub",
    description: "GitHub 仓库/Issue/PR 操作（需填 GITHUB_PERSONAL_ACCESS_TOKEN）。",
    suggestedName: "github",
    command: "docker",
    args: ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "-e", "GITHUB_TOOLSETS=default", "ghcr.io/github/github-mcp-server"],
    env: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    stability: "official",
  },
  {
    key: "playwright",
    title: "Playwright（浏览器自动化）",
    description: "浏览器自动化:导航、点击、抓取页面。",
    suggestedName: "playwright",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    stability: "official",
  },
];
