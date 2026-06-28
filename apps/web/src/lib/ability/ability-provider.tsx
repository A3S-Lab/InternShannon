import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createAppAbility, type SerializedAbility } from "./ability-context";
import { AbilityContext } from "./ability-context";

export function AbilityProvider({ children }: { children: ReactNode }) {
  const [snapshot] = useState<SerializedAbility>({
    version: "local",
    rules: [],
    permissions: ["*"],
    roles: ["local"],
    dataScopes: [],
    organizationIds: [],
    managedOrganizationIds: [],
    generatedAt: new Date(0).toISOString(),
  });
  const [loading] = useState(false);

  const refresh = useCallback(async () => {
    return undefined;
  }, []);

  const ability = useMemo(() => createAppAbility(snapshot), [snapshot]);
  const value = useMemo(() => ({ ability, snapshot, loading, refresh }), [ability, loading, refresh, snapshot]);

  return <AbilityContext.Provider value={value}>{children}</AbilityContext.Provider>;
}
