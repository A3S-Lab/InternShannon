const DEFAULT_PROFILE_BUTTON_LABEL = "打开个人资料";

export function resolveProfileButtonLabel(nickname?: string | null): string {
  const name = nickname?.trim();
  return name ? `打开个人资料：${name}` : DEFAULT_PROFILE_BUTTON_LABEL;
}
