import NiceAvatar, { type AvatarFullConfig } from "react-nice-avatar";
import { useSnapshot } from "valtio";
import type { AgentProfile } from "@/lib/agent-profile.types";
import { isDefaultAgentId } from "@/lib/builtins";
import { cn } from "@/lib/utils";
import assistantIdentityModel from "@/models/assistant-identity.model";

/**
 * 智能体头像统一入口。把「默认智能助手(InternShannon)配置了头像 URL → 渲染 <img>,否则回退内置
 * nice-avatar」这条逻辑收敛到一处(原先只在 agent-session-sidebar 的头部内联实现),供所有渲染
 * 智能体头像的入口复用,使超管在身份配置页设置的头像 URL 处处生效。
 *
 * 仅当画像是「默认智能助手」(isDefaultAgentId(agent.id))且 assistantIdentityModel 有非空的
 * 配置头像 URL 时才走 <img>;其余非默认智能体以及「未配置头像 URL 的
 * 默认助手」一律保持原来的 <NiceAvatar>,外观逐字节不变。
 */
export interface AgentAvatarProps extends AvatarFullConfig {
  /**
   * 该头像代表的智能体画像(今天喂给 `<NiceAvatar {...profile.avatar} />` 的那个对象)。
   * 用于判定是否默认助手 + 取内置头像/解析名;为空时只渲染回退 NiceAvatar。
   */
  agent: Pick<AgentProfile, "id" | "name" | "avatar"> | null | undefined;
  /** 与原 NiceAvatar 调用点一致的尺寸/圆角等类名;<img> 分支会原样套用以匹配同一个头像圈。 */
  className?: string;
}

export function AgentAvatar({ agent, className, ...avatarConfigOverrides }: AgentAvatarProps) {
  // 订阅助手身份:超管在身份配置页保存后(applySettings)此处响应式更新,头像即时切换。
  const identitySnap = useSnapshot(assistantIdentityModel.state);
  const configuredAvatarUrl = identitySnap.avatar.trim();

  // 复刻 agent-session-sidebar 头部原有逻辑:默认助手 + 配了 URL → <img>(同宽高/圆角/object-cover)。
  if (agent && isDefaultAgentId(agent.id) && configuredAvatarUrl) {
    return (
      <img
        src={configuredAvatarUrl}
        alt={agent.name ?? "InternShannon"}
        className={cn(className, "object-cover")}
      />
    );
  }

  // 其余一切(其它智能体 / 未配置 URL 的默认助手)保持原来的 nice-avatar,外观不变。
  // 调用点显式传入的头像字段覆盖 profile.avatar(供市场/网格等仍用 genConfig(...) 的入口逐字节复刻)。
  const avatarConfig: AvatarFullConfig = { ...agent?.avatar, ...avatarConfigOverrides };
  return <NiceAvatar className={className} {...avatarConfig} />;
}
