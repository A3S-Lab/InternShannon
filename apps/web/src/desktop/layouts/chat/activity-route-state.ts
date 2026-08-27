const STATIC_ROUTE_ALIASES: Array<{ prefix: string; key: string }> = [
  { prefix: "/settings", key: "settings" },
  { prefix: "/knowledge", key: "knowledge" },
  { prefix: "/skills", key: "skills" },
  { prefix: "/agent", key: "skills" },
];

export function pathToActivityKey(
  pathname: string,
  pluginPaths: Record<string, string>,
  staticKeys: readonly string[],
  staticRouteMap: Record<string, string>,
): string {
  const segment = pathname.replace(/^\//, "");
  const firstSegment = segment.split("/")[0] || "chat";

  for (const [pluginId, pluginPath] of Object.entries(pluginPaths)) {
    if (pathname === pluginPath || pathname.startsWith(`${pluginPath}/`)) {
      return pluginId;
    }
  }

  for (const alias of STATIC_ROUTE_ALIASES) {
    if (pathname === alias.prefix || pathname.startsWith(`${alias.prefix}/`)) {
      return alias.key;
    }
  }

  return staticKeys.includes(firstSegment) || firstSegment in staticRouteMap ? firstSegment : "chat";
}

export function shouldPersistActivityKey(
  pathname: string,
  activeKey: string,
  routeMap: Record<string, string>,
): boolean {
  if (pathname === "/" || !(activeKey in routeMap)) return false;
  return activeKey !== "chat";
}

export type StoredActivityRouteDecision = { kind: "none" } | { kind: "navigate"; path: string } | { kind: "clear" };

export function resolveStoredActivityRoute(input: {
  storedKey: string | null;
  pathname: string;
  routeMap: Record<string, string>;
  staticKeys: readonly string[];
  knowledgeReturnRequestId?: string | null;
}): StoredActivityRouteDecision {
  // Returning from a knowledge-source preview is an explicit chat navigation.
  // Clear the persisted activity before it can redirect the root route back to
  // the user's previously-opened knowledge page.
  if (input.pathname === "/" && input.knowledgeReturnRequestId) {
    return { kind: "clear" };
  }

  if (!input.storedKey || input.storedKey === "chat") return { kind: "none" };

  const storedPath = input.routeMap[input.storedKey];
  if (storedPath) {
    return input.pathname === "/" ? { kind: "navigate", path: storedPath } : { kind: "none" };
  }

  if (input.staticKeys.includes(input.storedKey)) {
    return { kind: "clear" };
  }

  return { kind: "none" };
}
