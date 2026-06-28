import type { AbilitySubjectInput, AppAction } from "./ability-context";
import { useAbility, useAbilityState } from "./ability-context";

export function useCan(action: AppAction, subject: AbilitySubjectInput, field?: string): boolean {
  return useAbility().can(action, subject, field);
}

export function useCanPermission(permission: string): boolean {
  return useAbility().canPermission(permission);
}

/**
 * Whether the current operator is a platform admin (super-admin) — keyed on the
 * `'*'` wildcard permission or a global role. Desktop normally grants local
 * capabilities directly, but this keeps legacy admin-only affordances hidden
 * unless a restored snapshot explicitly enables them.
 */
export function useIsPlatformAdmin(): boolean {
  const { snapshot } = useAbilityState();
  const permissions = snapshot?.permissions ?? [];
  const roles = snapshot?.roles ?? [];
  return permissions.includes("*") || roles.includes("super-admin") || roles.includes("platform-admin");
}
