const REMOTE_URI_RE = /^([a-z][a-z0-9+.-]*):\/{2,}(.*)$/i;
const SINGLE_SLASH_REMOTE_URI_RE = /^([a-z][a-z0-9+.-]{1,}):\/(?!\/)(.*)$/i;

function splitRemoteUri(value: string): { scheme: string; body: string } | null {
  const normalized = value.trim().replace(/\\/g, "/");
  const doubleSlashMatch = normalized.match(REMOTE_URI_RE);
  if (doubleSlashMatch) {
    return { scheme: doubleSlashMatch[1], body: doubleSlashMatch[2] };
  }

  const singleSlashMatch = normalized.match(SINGLE_SLASH_REMOTE_URI_RE);
  if (singleSlashMatch && singleSlashMatch[1].toLowerCase() !== "file") {
    return { scheme: singleSlashMatch[1], body: singleSlashMatch[2] };
  }

  return null;
}

export function isRemoteWorkspacePath(value: string | null | undefined): boolean {
  const remote = splitRemoteUri(value ?? "");
  return Boolean(remote && remote.scheme.toLowerCase() !== "file");
}

export function exposeWorkspacePath(
  value: string | null | undefined,
  options: { allowLocal?: boolean } = {},
): string {
  const normalized = normalizeWorkspacePath(value);
  if (!normalized) return "";
  if (options.allowLocal || isRemoteWorkspacePath(normalized)) return normalized;
  return "";
}

function cleanRemoteBody(value: string): string {
  return value.replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
}

function normalizeFirstPart(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/");
  const remote = splitRemoteUri(normalized);
  if (remote) {
    const body = cleanRemoteBody(remote.body);
    return body ? `${remote.scheme}://${body}` : `${remote.scheme}://`;
  }
  if (normalized === "/") return "/";
  return normalized.replace(/\/+$/g, "");
}

function normalizeSegment(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export function normalizeWorkspacePath(value: string | null | undefined): string {
  const normalized = (value ?? "").trim().replace(/\\/g, "/");
  if (!normalized) return "";
  const remote = splitRemoteUri(normalized);
  if (remote) {
    const body = cleanRemoteBody(remote.body);
    return body ? `${remote.scheme}://${body}` : `${remote.scheme}://`;
  }
  if (normalized === "/") return "/";
  return normalized.replace(/([^:])\/{2,}/g, "$1/").replace(/\/+$/g, "");
}

export function joinWorkspacePath(...parts: Array<string | null | undefined>): string {
  const [first, ...rest] = parts
    .map((part) => part?.trim() ?? "")
    .filter(Boolean);
  if (!first) return "";

  const root = normalizeFirstPart(first);
  const segments = rest.map(normalizeSegment).filter(Boolean);
  if (segments.length === 0) return root;
  if (!root) return segments.join("/");
  if (root === "/") return `/${segments.join("/")}`;
  if (/^[a-z][a-z0-9+.-]*:\/\/$/i.test(root)) return `${root}${segments.join("/")}`;
  return [root, ...segments].join("/");
}

export function getParentWorkspacePath(value: string | null | undefined): string {
  const normalized = normalizeWorkspacePath(value);
  if (!normalized || normalized === "/") return "";

  const remote = splitRemoteUri(normalized);
  if (remote) {
    const body = cleanRemoteBody(remote.body);
    const index = body.lastIndexOf("/");
    if (index <= 0) return "";
    return `${remote.scheme}://${body.slice(0, index)}`;
  }

  const index = normalized.lastIndexOf("/");
  if (index > 0) return normalized.slice(0, index);
  if (index === 0) return "/";
  return "";
}

export function getWorkspaceBaseName(value: string | null | undefined): string {
  const normalized = normalizeWorkspacePath(value);
  if (!normalized || normalized === "/") return "";
  const remote = splitRemoteUri(normalized);
  const target = remote ? cleanRemoteBody(remote.body) : normalized;
  return target.split("/").filter(Boolean).pop() ?? "";
}

export function getWorkspaceRelativePath(rootPath: string | null | undefined, value: string): string {
  const root = normalizeWorkspacePath(rootPath);
  const path = normalizeWorkspacePath(value);
  if (!root) return path;
  if (path === root) return ".";
  if (path.startsWith(`${root}/`)) {
    return path.slice(root.length + 1);
  }
  return path;
}
