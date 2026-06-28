/**
 * Workspace API client for NestJS sidecar.
 * Replaces Tauri invokeDesktop calls for workspace operations.
 */
import { apiRawFetch } from "./api/client";
import { assetsApi, type AssetRepositoryTree } from "./api/assets";
import { parseAssetWorkspacePath, type AssetWorkspacePath } from "./asset-workspace-path";
import { apiFetch } from "./http";
import { normalizeWorkspacePath } from "./workspace-path";

export type WorkspaceReadiness = {
  workspaceRoot: string;
  rootExists: boolean;
  agentsExists: boolean;
  sessionsExists: boolean;
  needsRepair: boolean;
  platform: string;
  isWindows: boolean;
};

export type WsDirEntry = {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  size?: number;
  mtimeMs?: number;
  modifiedAt?: string;
  extension?: string;
  isBinary?: boolean;
};

export type SearchMatch = {
  line: number;
  column: number;
  text: string;
  matchStart: number;
  matchEnd: number;
};

export type SearchResult = {
  path: string;
  matches: SearchMatch[];
};

export type ReplaceResult = {
  filesModified: number;
  totalReplacements: number;
  files: Array<{
    path: string;
    replacements: number;
  }>;
};

export type GitFileStatus = {
  path: string;
  status: string;
  staged: boolean;
};

export type GitStatusResult = {
  isGitRepo: boolean;
  branch?: string;
  files: GitFileStatus[];
};

const ASSET_TREE_CACHE_TTL_MS = 1500;

const assetWorkspaceTreeCache = new Map<
  string,
  {
    expiresAt: number;
    data?: AssetRepositoryTree;
    promise?: Promise<AssetRepositoryTree>;
  }
>();

function isWorkspaceApiDebugEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem("internshannon-file-tree-debug") === "true";
  } catch {
    return false;
  }
}

function debugWorkspaceApi(...args: unknown[]): void {
  if (isWorkspaceApiDebugEnabled()) {
    console.debug(...args);
  }
}

function normalizeWorkspaceApiPath(value: string): string {
  return normalizeWorkspacePath(value);
}

function getFileExtension(name: string): string | undefined {
  const ext = name.split(".").pop();
  return ext && ext !== name ? ext.toLowerCase() : undefined;
}

function decodeBase64Bytes(value: string): Uint8Array {
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  const bufferCtor = (globalThis as { Buffer?: { from(input: string, encoding: string): Uint8Array } }).Buffer;
  return bufferCtor?.from(value, "base64") ?? new Uint8Array();
}

function encodeUtf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function assetCommitMessage(relativePath: string) {
  return relativePath ? `Update ${relativePath}` : "Update asset files";
}

function assetDeleteMessage(relativePath: string) {
  return relativePath ? `Delete ${relativePath}` : "Delete asset files";
}

function assetRenameMessage(fromPath: string, toPath: string) {
  return `Rename ${fromPath || "asset files"} to ${toPath || "asset files"}`;
}

function assetWorkspaceTreeCacheKey(root: AssetWorkspacePath, relativePath = root.relativePath): string {
  return `${root.assetId}\n${root.ref}\n${relativePath}`;
}

async function fetchAssetWorkspaceTree(root: AssetWorkspacePath): Promise<AssetRepositoryTree> {
  const key = assetWorkspaceTreeCacheKey(root);
  const now = Date.now();
  const cached = assetWorkspaceTreeCache.get(key);
  if (cached && cached.expiresAt > now) {
    if (cached.data) {
      debugWorkspaceApi("[workspaceApi] asset tree cache hit", {
        assetId: root.assetId,
        ref: root.ref,
        path: root.relativePath,
      });
      return cached.data;
    }
    if (cached.promise) {
      debugWorkspaceApi("[workspaceApi] asset tree request deduped", {
        assetId: root.assetId,
        ref: root.ref,
        path: root.relativePath,
      });
      return cached.promise;
    }
  }

  const promise = assetsApi.repositoryTree(root.assetId, {
    ref: root.ref,
    path: root.relativePath,
    page: 1,
    limit: 1000,
  });
  assetWorkspaceTreeCache.set(key, {
    expiresAt: now + ASSET_TREE_CACHE_TTL_MS,
    promise,
  });

  try {
    const data = await promise;
    assetWorkspaceTreeCache.set(key, {
      expiresAt: Date.now() + ASSET_TREE_CACHE_TTL_MS,
      data,
    });
    return data;
  } catch (error) {
    assetWorkspaceTreeCache.delete(key);
    throw error;
  }
}

function invalidateAssetWorkspaceTreeCache(root: AssetWorkspacePath): void {
  const paths = new Set<string>([""]);
  let current = root.relativePath.split("/").slice(0, -1).join("/");
  while (current) {
    paths.add(current);
    current = current.split("/").slice(0, -1).join("/");
  }
  for (const path of paths) {
    assetWorkspaceTreeCache.delete(assetWorkspaceTreeCacheKey(root, path));
  }
}

function unsupportedAssetWorkspaceOperation(operation: string): never {
  throw new Error(`资产在线编辑暂不支持${operation}`);
}

function compileSearchMatcher(
  query: string,
  options?: {
    caseSensitive?: boolean;
    useRegex?: boolean;
    matchWholeWord?: boolean;
  },
): RegExp {
  const flags = options?.caseSensitive ? "g" : "gi";
  const source = options?.useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(options?.matchWholeWord ? `\\b(?:${source})\\b` : source, flags);
}

function matchesPattern(path: string, pattern?: string) {
  const trimmed = pattern?.trim();
  if (!trimmed) return true;
  const parts = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return true;
  return parts.some((part) => {
    const regex = new RegExp(`^${part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    return regex.test(path) || path.includes(part);
  });
}

function excludesPath(path: string, pattern?: string) {
  return pattern?.trim() ? matchesPattern(path, pattern) : false;
}

async function listAssetWorkspaceFiles(root: AssetWorkspacePath, path = ""): Promise<string[]> {
  const data = await fetchAssetWorkspaceTree({ ...root, relativePath: path });
  const nested = await Promise.all(
    data.items.map((item) => {
      if (item.type === "tree") {
        return listAssetWorkspaceFiles(root, item.path);
      }
      return Promise.resolve(item.type === "blob" ? [item.path] : []);
    }),
  );
  return nested.flat();
}

async function readAssetWorkspaceFile(parsed: AssetWorkspacePath): Promise<string> {
  if (!parsed.relativePath) {
    throw new Error("请选择要读取的资产文件");
  }
  const blob = await assetsApi.repositoryBlob(parsed.assetId, {
    ref: parsed.ref,
    path: parsed.relativePath,
  });
  if (blob.encoding === "base64") {
    throw new Error("二进制文件无法作为文本打开");
  }
  return blob.content;
}

async function writeAssetWorkspaceFile(parsed: AssetWorkspacePath, content: string): Promise<void> {
  if (!parsed.relativePath) {
    throw new Error("请选择要写入的资产文件");
  }
  await assetsApi.updateBlob(parsed.assetId, parsed.relativePath, {
    content,
    message: assetCommitMessage(parsed.relativePath),
    branch: parsed.ref,
  });
  invalidateAssetWorkspaceTreeCache(parsed);
}

async function searchAssetWorkspaceFiles(
  root: AssetWorkspacePath,
  query: string,
  options?: {
    caseSensitive?: boolean;
    useRegex?: boolean;
    matchWholeWord?: boolean;
    includePattern?: string;
    excludePattern?: string;
    maxResults?: number;
  },
): Promise<SearchResult[]> {
  if (!query) return [];
  const matcher = compileSearchMatcher(query, options);
  const files = (await listAssetWorkspaceFiles(root, root.relativePath)).filter(
    (path) => matchesPattern(path, options?.includePattern) && !excludesPath(path, options?.excludePattern),
  );
  const maxResults = Math.max(1, options?.maxResults ?? 1000);
  const results: SearchResult[] = [];
  let matchCount = 0;

  for (const path of files) {
    if (matchCount >= maxResults) break;
    const content = await readAssetWorkspaceFile({ ...root, relativePath: path }).catch(() => "");
    if (!content) continue;
    const matches: SearchMatch[] = [];
    content.split(/\r?\n/).forEach((line, lineIndex) => {
      matcher.lastIndex = 0;
      for (const match of line.matchAll(matcher)) {
        if (match.index === undefined || match[0] === "") continue;
        matches.push({
          line: lineIndex + 1,
          column: match.index + 1,
          text: line,
          matchStart: match.index,
          matchEnd: match.index + match[0].length,
        });
        matchCount += 1;
        if (matchCount >= maxResults) break;
      }
    });
    if (matches.length > 0) {
      results.push({ path, matches });
    }
  }

  return results;
}

async function replaceAssetWorkspaceFiles(
  root: AssetWorkspacePath,
  query: string,
  replacement: string,
  options?: {
    caseSensitive?: boolean;
    useRegex?: boolean;
    matchWholeWord?: boolean;
    includePattern?: string;
    excludePattern?: string;
    filePaths?: string[];
  },
): Promise<ReplaceResult> {
  const matcher = compileSearchMatcher(query, options);
  const candidateFiles =
    options?.filePaths && options.filePaths.length > 0
      ? options.filePaths
      : (await listAssetWorkspaceFiles(root, root.relativePath)).filter(
          (path) => matchesPattern(path, options?.includePattern) && !excludesPath(path, options?.excludePattern),
        );
  const files: ReplaceResult["files"] = [];
  let totalReplacements = 0;

  for (const path of candidateFiles) {
    const content = await readAssetWorkspaceFile({ ...root, relativePath: path }).catch(() => "");
    if (!content) continue;
    matcher.lastIndex = 0;
    const matches = Array.from(content.matchAll(matcher));
    if (matches.length === 0) continue;
    const nextContent = content.replace(matcher, replacement);
    await writeAssetWorkspaceFile({ ...root, relativePath: path }, nextContent);
    files.push({ path, replacements: matches.length });
    totalReplacements += matches.length;
  }

  return {
    filesModified: files.length,
    totalReplacements,
    files,
  };
}

export const workspaceApi = {
  getDefaultRoot: () => apiFetch<{ root: string }>("/workspace/default-root").then((r) => r.root),

  inspectReadiness: (workspaceRoot?: string) => {
    const qs = workspaceRoot ? `?workspaceRoot=${encodeURIComponent(normalizeWorkspaceApiPath(workspaceRoot))}` : "";
    return apiFetch<WorkspaceReadiness>(`/workspace/readiness${qs}`);
  },

  ensureReadiness: (workspaceRoot?: string) => {
    const qs = workspaceRoot ? `?workspaceRoot=${encodeURIComponent(normalizeWorkspaceApiPath(workspaceRoot))}` : "";
    return apiFetch<WorkspaceReadiness>(`/workspace/readiness${qs}`, {
      method: "POST",
    });
  },

  initAgent: (workspacePath: string) =>
    apiFetch("/workspace/init-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspacePath: normalizeWorkspaceApiPath(workspacePath) }),
    }),

  mkdir: (path: string) => {
    const parsed = parseAssetWorkspacePath(path);
    if (parsed) {
      if (!parsed.relativePath) return Promise.resolve({ success: true });
      return writeAssetWorkspaceFile(
        { ...parsed, relativePath: `${parsed.relativePath.replace(/\/+$/g, "")}/.gitkeep` },
        "",
      ).then(() => ({ success: true }));
    }
    return apiFetch("/workspace/mkdir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: normalizeWorkspaceApiPath(path) }),
    });
  },

  writeFile: (path: string, content: string) => {
    const parsed = parseAssetWorkspacePath(path);
    if (parsed) {
      return writeAssetWorkspaceFile(parsed, content).then(() => ({ success: true }));
    }
    return apiFetch("/workspace/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: normalizeWorkspaceApiPath(path), content }),
    });
  },

  readFile: (path: string) => {
    const parsed = parseAssetWorkspacePath(path);
    if (parsed) return readAssetWorkspaceFile(parsed);
    const qs = `?path=${encodeURIComponent(normalizeWorkspaceApiPath(path))}`;
    return apiFetch<{ content: string }>(`/workspace/read${qs}`).then((r) => r.content);
  },

  fileExists: (path: string) => {
    const parsed = parseAssetWorkspacePath(path);
    if (parsed) {
      if (!parsed.relativePath) return Promise.resolve(true);
      const parentPath = parsed.relativePath.split("/").slice(0, -1).join("/");
      const name = parsed.relativePath.split("/").pop();
      return fetchAssetWorkspaceTree({ ...parsed, relativePath: parentPath })
        .then((tree) => tree.items.some((item) => item.name === name))
        .catch(() => false);
    }
    const qs = `?path=${encodeURIComponent(normalizeWorkspaceApiPath(path))}`;
    return apiFetch<{ exists: boolean }>(`/workspace/exists${qs}`).then((r) => r.exists);
  },

  remove: (path: string) => {
    const parsed = parseAssetWorkspacePath(path);
    if (parsed) {
      if (!parsed.relativePath) {
        unsupportedAssetWorkspaceOperation("删除资产根目录");
      }
      return assetsApi
        .deleteBlob(parsed.assetId, parsed.relativePath, {
          message: assetDeleteMessage(parsed.relativePath),
          branch: parsed.ref,
        })
        .then(() => {
          invalidateAssetWorkspaceTreeCache(parsed);
          return { success: true };
        });
    }
    return apiFetch(`/workspace/delete?path=${encodeURIComponent(normalizeWorkspaceApiPath(path))}`, {
      method: "DELETE",
    });
  },

  readDir: async (path: string): Promise<WsDirEntry[]> => {
    const normalizedPath = normalizeWorkspaceApiPath(path);
    debugWorkspaceApi("[workspaceApi] readDir", normalizedPath);
    const parsed = parseAssetWorkspacePath(normalizedPath);
    if (parsed) {
      const data = await fetchAssetWorkspaceTree(parsed);
      return data.items.map((item) => ({
        name: item.name,
        isDirectory: item.type === "tree",
        isFile: item.type === "blob",
        size: item.size ?? undefined,
        extension: item.type === "blob" ? getFileExtension(item.name) : undefined,
        isBinary: false,
      }));
    }
    const qs = `?path=${encodeURIComponent(normalizedPath)}`;
    try {
      const result = await apiFetch<WsDirEntry[]>(`/workspace/read-dir${qs}`);
      debugWorkspaceApi("[workspaceApi] readDir success", {
        path: normalizedPath,
        count: result.length,
        sample: result.slice(0, 5),
      });
      return result;
    } catch (error) {
      console.error("[workspaceApi] readDir failed", { path: normalizedPath, error });
      throw error;
    }
  },

  rename: (src: string, dest: string) => {
    const parsedSrc = parseAssetWorkspacePath(src);
    const parsedDest = parseAssetWorkspacePath(dest);
    if (parsedSrc || parsedDest) {
      if (
        !parsedSrc ||
        !parsedDest ||
        parsedSrc.assetId !== parsedDest.assetId ||
        parsedSrc.ref !== parsedDest.ref ||
        !parsedSrc.relativePath ||
        !parsedDest.relativePath
      ) {
        unsupportedAssetWorkspaceOperation("跨工作区重命名文件");
      }
      return assetsApi
        .renameBlob(parsedSrc.assetId, parsedSrc.relativePath, {
          toPath: parsedDest.relativePath,
          message: assetRenameMessage(parsedSrc.relativePath, parsedDest.relativePath),
          branch: parsedSrc.ref,
        })
        .then(() => {
          invalidateAssetWorkspaceTreeCache(parsedSrc);
          invalidateAssetWorkspaceTreeCache(parsedDest);
          return { success: true };
        });
    }
    return apiFetch("/workspace/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ src: normalizeWorkspaceApiPath(src), dest: normalizeWorkspaceApiPath(dest) }),
    });
  },

  copyFile: (src: string, dest: string) => {
    const parsedSrc = parseAssetWorkspacePath(src);
    const parsedDest = parseAssetWorkspacePath(dest);
    if (parsedSrc || parsedDest) {
      if (!parsedSrc || !parsedDest || parsedSrc.assetId !== parsedDest.assetId || parsedSrc.ref !== parsedDest.ref) {
        unsupportedAssetWorkspaceOperation("跨工作区复制文件");
      }
      return readAssetWorkspaceFile(parsedSrc)
        .then((content) => writeAssetWorkspaceFile(parsedDest, content))
        .then(() => ({ success: true }));
    }
    return apiFetch("/workspace/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ src: normalizeWorkspaceApiPath(src), dest: normalizeWorkspaceApiPath(dest) }),
    });
  },

  readBinaryFile: async (path: string): Promise<Uint8Array> => {
    const parsed = parseAssetWorkspacePath(path);
    if (parsed) {
      const blob = await assetsApi.repositoryBlob(parsed.assetId, {
        ref: parsed.ref,
        path: parsed.relativePath,
      });
      return blob.encoding === "base64" ? decodeBase64Bytes(blob.content) : encodeUtf8Bytes(blob.content);
    }
    const qs = `?path=${encodeURIComponent(normalizeWorkspaceApiPath(path))}`;
    const res = await apiRawFetch(`/workspace/read-binary${qs}`, {
      method: "GET",
    });
    return new Uint8Array(await res.arrayBuffer());
  },

  writeBinaryFile: (path: string, data: number[]) => {
    if (parseAssetWorkspacePath(path)) {
      unsupportedAssetWorkspaceOperation("写入二进制文件");
    }
    return apiFetch("/workspace/write-binary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: normalizeWorkspaceApiPath(path), data }),
    });
  },

  searchInFiles: (
    rootPath: string,
    query: string,
    options?: {
      caseSensitive?: boolean;
      useRegex?: boolean;
      matchWholeWord?: boolean;
      includePattern?: string;
      excludePattern?: string;
      maxResults?: number;
    },
  ) => {
    const parsed = parseAssetWorkspacePath(rootPath);
    if (parsed) {
      return searchAssetWorkspaceFiles(parsed, query, options);
    }
    const params = new URLSearchParams({
      rootPath: normalizeWorkspaceApiPath(rootPath),
      query,
      ...(options?.caseSensitive !== undefined && { caseSensitive: String(options.caseSensitive) }),
      ...(options?.useRegex !== undefined && { useRegex: String(options.useRegex) }),
      ...(options?.matchWholeWord !== undefined && { matchWholeWord: String(options.matchWholeWord) }),
      ...(options?.includePattern && { includePattern: options.includePattern }),
      ...(options?.excludePattern && { excludePattern: options.excludePattern }),
      ...(options?.maxResults !== undefined && { maxResults: String(options.maxResults) }),
    });
    return apiFetch<SearchResult[]>(`/workspace/search?${params.toString()}`);
  },

  replaceInFiles: (
    rootPath: string,
    query: string,
    replacement: string,
    options?: {
      caseSensitive?: boolean;
      useRegex?: boolean;
      matchWholeWord?: boolean;
      includePattern?: string;
      excludePattern?: string;
      filePaths?: string[];
    },
  ) => {
    const parsed = parseAssetWorkspacePath(rootPath);
    if (parsed) {
      return replaceAssetWorkspaceFiles(parsed, query, replacement, options);
    }
    return apiFetch<ReplaceResult>("/workspace/replace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rootPath: normalizeWorkspaceApiPath(rootPath),
        query,
        replacement,
        caseSensitive: options?.caseSensitive,
        useRegex: options?.useRegex,
        matchWholeWord: options?.matchWholeWord,
        includePattern: options?.includePattern,
        excludePattern: options?.excludePattern,
        filePaths: options?.filePaths,
      }),
    });
  },

  getGitStatus: (rootPath: string) => {
    const parsed = parseAssetWorkspacePath(rootPath);
    if (parsed) {
      return Promise.resolve({
        isGitRepo: true,
        branch: parsed.ref,
        files: [],
      } satisfies GitStatusResult);
    }
    const params = new URLSearchParams({ rootPath: normalizeWorkspaceApiPath(rootPath) });
    return apiFetch<GitStatusResult>(`/workspace/git-status?${params.toString()}`);
  },
};
