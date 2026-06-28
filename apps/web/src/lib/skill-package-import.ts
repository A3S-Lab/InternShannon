import JSZip from "jszip";

import { workspaceApi } from "@/lib/workspace-api";
import { joinWorkspacePath } from "@/lib/workspace-path";

export interface SkillPackageImportItem {
  sourceName: string;
  targetPath: string;
  fileCount: number;
  kind: "file" | "zip";
}

export interface SkillPackageImportSummary {
  items: SkillPackageImportItem[];
  fileCount: number;
}

const TEXT_EXTENSIONS = new Set([
  "bash",
  "conf",
  "css",
  "csv",
  "env",
  "gitignore",
  "htm",
  "html",
  "ini",
  "js",
  "json",
  "jsonc",
  "jsx",
  "md",
  "mdx",
  "py",
  "sh",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);

const INVALID_PATH_CHARS = new Set(["<", ">", ":", '"', "|", "?", "*", "\\"]);

export const SUPPORTED_EXTERNAL_SKILL_ACCEPT = [
  ".zip",
  ".md",
  ".mdx",
  ".txt",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".sh",
  ".bash",
].join(",");

function replaceInvalidPathCharacters(value: string): string {
  let result = "";
  for (const char of value) {
    result += char.charCodeAt(0) < 32 || INVALID_PATH_CHARS.has(char) ? "-" : char;
  }
  return result;
}

function sanitizePathSegment(value: string, fallback: string): string {
  const sanitized = replaceInvalidPathCharacters(value)
    .replace(/\s+/g, " ")
    .replace(/^\/+|\/+$/g, "")
    .trim();
  if (!sanitized || sanitized === "." || sanitized === "..") return fallback;
  return sanitized;
}

export function normalizeSkillInstallName(
  name: string,
  options?: { stripSingleFileExtension?: boolean },
): string {
  const rawName = options?.stripSingleFileExtension ? name.replace(/\.(md|txt)$/i, "") : name;
  return sanitizePathSegment(rawName, "skill");
}

function sanitizeRelativePath(path: string): string | null {
  const segments = path
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => sanitizePathSegment(segment, ""))
    .filter((segment) => segment && segment !== "." && segment !== "..");
  return segments.length > 0 ? segments.join("/") : null;
}

function splitFilename(name: string): { stem: string; extension: string } {
  const normalized = sanitizePathSegment(name || "skill", "skill");
  const dotIndex = normalized.lastIndexOf(".");
  if (dotIndex <= 0) {
    return { stem: normalized, extension: "" };
  }
  return {
    stem: normalized.slice(0, dotIndex),
    extension: normalized.slice(dotIndex),
  };
}

function stripZipExtension(name: string): string {
  return sanitizePathSegment(name.replace(/\.zip$/i, ""), "skill");
}

function extensionOf(path: string): string {
  const baseName = path.split("/").pop() ?? path;
  const dotIndex = baseName.lastIndexOf(".");
  if (dotIndex < 0) return "";
  return baseName.slice(dotIndex + 1).toLowerCase();
}

function isTextPath(path: string): boolean {
  return TEXT_EXTENSIONS.has(extensionOf(path));
}

function isZipName(name: string): boolean {
  return /\.zip$/i.test(name);
}

function isSystemZipEntry(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return normalized.startsWith("__MACOSX/") || normalized.endsWith("/.DS_Store") || normalized === ".DS_Store";
}

async function uniqueWorkspacePath(parentPath: string, requestedName: string): Promise<string> {
  const { stem, extension } = splitFilename(requestedName);
  let candidateName = `${stem}${extension}`;
  let candidatePath = joinWorkspacePath(parentPath, candidateName);
  let index = 2;

  while (await workspaceApi.fileExists(candidatePath).catch(() => false)) {
    candidateName = `${stem}-${index}${extension}`;
    candidatePath = joinWorkspacePath(parentPath, candidateName);
    index += 1;
  }
  return candidatePath;
}

async function writeWorkspaceFile(path: string, content: string | Uint8Array): Promise<void> {
  const separatorIndex = path.lastIndexOf("/");
  const parentPath = separatorIndex > 0 ? path.slice(0, separatorIndex) : "";
  if (parentPath) {
    await workspaceApi.mkdir(parentPath);
  }
  if (typeof content === "string") {
    await workspaceApi.writeFile(path, content);
    return;
  }
  await workspaceApi.writeBinaryFile(path, Array.from(content));
}

function commonZipRoot(paths: string[]): string | undefined {
  const roots = new Set<string>();
  for (const path of paths) {
    const [root, ...rest] = path.split("/");
    if (!root || rest.length === 0) {
      return undefined;
    }
    roots.add(root);
  }

  if (roots.size !== 1) {
    return undefined;
  }

  return Array.from(roots)[0];
}

async function installZipEntries(targetDir: string, zipContent: ArrayBuffer): Promise<number> {
  const zip = await JSZip.loadAsync(zipContent);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && !isSystemZipEntry(entry.name));
  const normalizedEntries = entries
    .map((entry) => ({ entry, path: sanitizeRelativePath(entry.name) }))
    .filter((item): item is { entry: JSZip.JSZipObject; path: string } => !!item.path);
  const normalizedPaths = normalizedEntries.map((item) => item.path);
  const rootToStrip = commonZipRoot(normalizedPaths);
  const pathByEntryName = new Map<string, string>();

  normalizedEntries.forEach(({ entry, path }) => {
    const nextPath = rootToStrip && path.startsWith(`${rootToStrip}/`) ? path.slice(rootToStrip.length + 1) : path;
    if (nextPath) {
      pathByEntryName.set(entry.name, nextPath);
    }
  });

  let fileCount = 0;
  for (const entry of entries) {
    const relativePath = pathByEntryName.get(entry.name);
    if (!relativePath) continue;
    const targetPath = joinWorkspacePath(targetDir, relativePath);
    if (isTextPath(relativePath)) {
      await writeWorkspaceFile(targetPath, await entry.async("text"));
    } else {
      await writeWorkspaceFile(targetPath, await entry.async("uint8array"));
    }
    fileCount += 1;
  }

  if (fileCount === 0) {
    throw new Error("技能 ZIP 中没有可导入的文件");
  }
  return fileCount;
}

async function assertLoadableSkillPackage(targetPath: string, sourceName: string): Promise<void> {
  const manifestPath = joinWorkspacePath(targetPath, "SKILL.md");
  if (await workspaceApi.fileExists(manifestPath).catch(() => false)) {
    return;
  }
  await workspaceApi.remove(targetPath).catch(() => undefined);
  throw new Error(`技能包 "${sourceName}" 缺少 SKILL.md，无法被InternShannon加载`);
}

export async function installSkillPackage(
  skillsPath: string,
  name: string,
  content: string | ArrayBuffer,
): Promise<SkillPackageImportItem> {
  await workspaceApi.mkdir(skillsPath);
  const safeName = normalizeSkillInstallName(name, { stripSingleFileExtension: typeof content === "string" });

  if (typeof content === "string") {
    const targetPath = await uniqueWorkspacePath(skillsPath, `${safeName}.md`);
    await writeWorkspaceFile(targetPath, content);
    return {
      sourceName: name,
      targetPath,
      fileCount: 1,
      kind: "file",
    };
  }

  const targetPath = await uniqueWorkspacePath(skillsPath, safeName);
  await workspaceApi.mkdir(targetPath);
  const fileCount = await installZipEntries(targetPath, content);
  await assertLoadableSkillPackage(targetPath, name);
  return {
    sourceName: name,
    targetPath,
    fileCount,
    kind: "zip",
  };
}

async function importExternalSkillFile(rootPath: string, file: File): Promise<SkillPackageImportItem> {
  if (isZipName(file.name)) {
    const targetPath = await uniqueWorkspacePath(rootPath, stripZipExtension(file.name));
    await workspaceApi.mkdir(targetPath);
    const fileCount = await installZipEntries(targetPath, await file.arrayBuffer());
    await assertLoadableSkillPackage(targetPath, file.name);
    return {
      sourceName: file.name,
      targetPath,
      fileCount,
      kind: "zip",
    };
  }

  const targetPath = await uniqueWorkspacePath(rootPath, file.name || "skill.md");
  const textLike = file.type.startsWith("text/") || isTextPath(file.name);
  if (textLike) {
    await writeWorkspaceFile(targetPath, await file.text());
  } else {
    await writeWorkspaceFile(targetPath, new Uint8Array(await file.arrayBuffer()));
  }
  return {
    sourceName: file.name,
    targetPath,
    fileCount: 1,
    kind: "file",
  };
}

export async function importExternalSkillFiles(rootPath: string, files: File[]): Promise<SkillPackageImportSummary> {
  if (!rootPath?.trim()) {
    throw new Error("技能工作区路径不可用");
  }

  const importableFiles = files.filter((file) => file.name && file.size >= 0);
  if (importableFiles.length === 0) {
    throw new Error("没有可导入的技能文件");
  }

  await workspaceApi.mkdir(rootPath);
  const items: SkillPackageImportItem[] = [];
  for (const file of importableFiles) {
    items.push(await importExternalSkillFile(rootPath, file));
  }

  return {
    items,
    fileCount: items.reduce((count, item) => count + item.fileCount, 0),
  };
}
