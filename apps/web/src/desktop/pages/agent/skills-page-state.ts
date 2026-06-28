export type SkillsPageStatusKind = "loading" | "retrying" | "error" | "not-ready" | "ready";

export interface SkillsPageStatus {
  kind: SkillsPageStatusKind;
  title: string;
  description: string;
}

export function resolveSkillsPageStatus(input: {
  loading: boolean;
  retrying?: boolean;
  error: string | null | undefined;
  skillsPath: string | null | undefined;
  sharedSkillsPath: string | null | undefined;
}): SkillsPageStatus {
  const hasWorkspacePaths = Boolean(input.skillsPath && input.sharedSkillsPath);

  if (input.retrying && !hasWorkspacePaths) {
    return {
      kind: "retrying",
      title: "正在重新准备技能工作区",
      description: "正在重新同步本地目录与智能体配置。",
    };
  }

  if (input.loading) {
    return {
      kind: "loading",
      title: "正在准备技能工作区",
      description: "正在同步本地目录与智能体配置。",
    };
  }

  if (input.error) {
    return {
      kind: "error",
      title: "技能工作区加载失败",
      description: input.error,
    };
  }

  if (!hasWorkspacePaths) {
    return {
      kind: "not-ready",
      title: "技能工作区尚未就绪",
      description: "未能获取个人技能或共享技能目录，请确认工作区已配置。",
    };
  }

  return {
    kind: "ready",
    title: "智能体配置",
    description: "智能体配置",
  };
}
