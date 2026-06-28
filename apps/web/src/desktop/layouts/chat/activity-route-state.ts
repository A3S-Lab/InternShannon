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
}): StoredActivityRouteDecision {
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
