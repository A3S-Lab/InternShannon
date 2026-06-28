/**
 * Pure render-decision for the `<RequirePermission>` gate, split out from the
 * React component so the policy is unit-testable without a DOM — the web app has
 * no React test harness; specs are pure `node:test`. Mirrors the semantics of
 * the `<Can>` component: `not` inverts the result, `passThrough` renders the
 * children even when denied (so a render-function child can disable rather than
 * hide). Kept in lockstep with the backend `@RequirePermissions(...)` contract.
 */

export interface PermissionGateModifiers {
  /** Invert the check — treat "lacks permission" as allowed. */
  not?: boolean;
  /** Render children even when denied (pair with a render-function child to disable, not hide). */
  passThrough?: boolean;
}

export interface PermissionGateDecision {
  /** What a render-function child receives — the (possibly inverted) grant result. */
  allowed: boolean;
  /** Whether the element-child branch renders `children` (true) or `fallback` (false). */
  showChildren: boolean;
}

/**
 * Resolve a raw permission grant into the gate's render decision.
 *
 * @param granted whether the caller holds the required permission(s)
 * @param modifiers `not` to invert, `passThrough` to render even when denied
 */
export function evaluatePermissionGate(
  granted: boolean,
  modifiers: PermissionGateModifiers = {},
): PermissionGateDecision {
  const allowed = granted !== Boolean(modifiers.not);
  return { allowed, showChildren: Boolean(modifiers.passThrough) || allowed };
}
