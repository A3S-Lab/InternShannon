import type { ReactNode } from "react";
import { useAbility, useAbilityState } from "./ability-context";
import { evaluatePermissionGate } from "./permission-gate";

export type PermissionInput = string | readonly string[];

export interface UsePermissionOptions {
  /** Require every permission instead of any (default: any). */
  all?: boolean;
}

/**
 * Multi-permission check against the current local capability snapshot. Returns
 * `false` while the snapshot is still loading so the UI doesn't flash protected
 * actions before the gate kicks in.
 *
 * For a single permission, prefer the simpler `useCanPermission(p)` —
 * use this only when you need multi-permission `any`/`all` semantics.
 *
 * For component-level subject + action checks, prefer `<Can I="..." a="...">`.
 *
 * @example
 *   const canManageKnowledge = usePermission(["knowledge:write", "agent:chat"], { all: true });
 *   return canManageKnowledge ? <KnowledgeEditor /> : null;
 */
export function usePermission(has: PermissionInput, options: UsePermissionOptions = {}): boolean {
  const ability = useAbility();
  const { loading } = useAbilityState();
  if (loading) return false;

  const required = Array.isArray(has) ? has : [has];
  if (required.length === 0) return true;

  return options.all ? required.every((p) => ability.canPermission(p)) : required.some((p) => ability.canPermission(p));
}

export interface RequirePermissionProps {
  /** Local capability code(s) to require. */
  permission: PermissionInput;
  /** Require every permission instead of any (default: any). */
  all?: boolean;
  /** Render when the user LACKS the permission instead of when they hold it. */
  not?: boolean;
  /** Render children even when denied — pair with a render-function child to disable rather than hide. */
  passThrough?: boolean;
  /** Rendered when denied (and not `passThrough`). Defaults to nothing. */
  fallback?: ReactNode;
  children: ReactNode | ((allowed: boolean) => ReactNode);
}

/**
 * Declarative local-capability gate — the component form of `usePermission`,
 * and the permission-code sibling of `<Can I="..." a="...">` (which gates by
 * ability subject + action). Reads the same global ability snapshot, so there
 * is no prop-drilling and one source of truth across menu / route / action
 * gating. Inherits `usePermission`'s loading anti-flash.
 *
 * @example
 *   // hide unless local knowledge editing is enabled
 *   <RequirePermission permission="knowledge:write">
 *     <KnowledgeEditor />
 *   </RequirePermission>
 *
 *   // disable (not hide) via a render-function child
 *   <RequirePermission permission="org:admin" passThrough>
 *     {allowed => <Button disabled={!allowed}>删除</Button>}
 *   </RequirePermission>
 */
export function RequirePermission({
  permission,
  all = false,
  not = false,
  passThrough = false,
  fallback = null,
  children,
}: RequirePermissionProps) {
  const granted = usePermission(permission, { all });
  const { allowed, showChildren } = evaluatePermissionGate(granted, { not, passThrough });

  if (typeof children === "function") {
    return <>{children(allowed)}</>;
  }
  return <>{showChildren ? children : fallback}</>;
}
