import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export type AppAction = string;
export type AbilitySubjectInput = string | { type?: string; subject?: string; [key: string]: unknown };

export interface SerializedAbilityRule {
  action?: AppAction | AppAction[];
  actions?: AppAction | AppAction[];
  subject?: string | string[];
  subjects?: string | string[];
  fields?: string[];
  inverted?: boolean;
}

export interface SerializedAbility {
  version?: string;
  rules?: SerializedAbilityRule[];
  permissions?: string[];
  roles?: string[];
  dataScopes?: string[];
  organizationIds?: string[];
  managedOrganizationIds?: string[];
  generatedAt?: string;
}

export interface AppAbility {
  can: (action: AppAction, subject: AbilitySubjectInput, field?: string) => boolean;
  canPermission: (permission: string) => boolean;
}

function list(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeSubject(subject: AbilitySubjectInput): string {
  if (typeof subject === "string") return subject;
  const typed = subject.type ?? subject.subject;
  return typeof typed === "string" ? typed : "all";
}

function matches(value: string, allowed: string[]): boolean {
  return allowed.includes("all") || allowed.includes("*") || allowed.includes(value);
}

function hasPlatformBypass(snapshot?: SerializedAbility): boolean {
  const permissions = snapshot?.permissions ?? [];
  const roles = snapshot?.roles ?? [];
  return permissions.includes("*") || roles.includes("super-admin") || roles.includes("platform-admin");
}

export function createAppAbility(input?: SerializedAbility | SerializedAbilityRule[]): AppAbility {
  const snapshot: SerializedAbility | undefined = Array.isArray(input) ? { rules: input } : input;
  const permissions = new Set(snapshot?.permissions ?? []);
  const rules = snapshot?.rules ?? [];

  return {
    can(action, subject, field) {
      if (hasPlatformBypass(snapshot)) return true;
      const subjectName = normalizeSubject(subject);

      for (const rule of rules) {
        const actions = [...list(rule.action), ...list(rule.actions)];
        const subjects = [...list(rule.subject), ...list(rule.subjects)];
        const fields = rule.fields ?? [];
        const actionMatches = actions.length === 0 || matches(action, actions);
        const subjectMatches = subjects.length === 0 || matches(subjectName, subjects);
        const fieldMatches = !field || fields.length === 0 || fields.includes(field);

        if (actionMatches && subjectMatches && fieldMatches) {
          return !rule.inverted;
        }
      }

      return false;
    },
    canPermission(permission) {
      if (hasPlatformBypass(snapshot)) return true;
      return permissions.has(permission);
    },
  };
}

export interface AbilityContextValue {
  ability: AppAbility;
  snapshot?: SerializedAbility;
  loading: boolean;
  refresh: () => Promise<void>;
}

const noopRefresh = async () => undefined;

export const AbilityContext = createContext<AbilityContextValue>({
  ability: createAppAbility({
    version: "local",
    permissions: ["*"],
    roles: ["local"],
    generatedAt: new Date(0).toISOString(),
  }),
  loading: false,
  refresh: noopRefresh,
});

export function useAbility(): AppAbility {
  return useContext(AbilityContext).ability;
}

export function useAbilityState(): AbilityContextValue {
  return useContext(AbilityContext);
}

export interface CanProps {
  I: AppAction;
  a?: AbilitySubjectInput;
  an?: AbilitySubjectInput;
  of?: AbilitySubjectInput;
  field?: string;
  not?: boolean;
  passThrough?: boolean;
  children: ReactNode | ((allowed: boolean) => ReactNode);
}

export function Can({ I, a, an, of, field, not = false, passThrough = false, children }: CanProps) {
  const ability = useAbility();
  const target = a ?? an ?? of;
  const allowed = target ? ability.can(I, target, field) !== not : false;

  if (typeof children === "function") {
    return <>{children(allowed)}</>;
  }
  if (passThrough || allowed) {
    return <>{children}</>;
  }
  return null;
}
