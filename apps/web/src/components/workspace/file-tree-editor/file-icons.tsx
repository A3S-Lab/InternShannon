import {
  Archive,
  Braces,
  Code,
  Database,
  File,
  FileCode,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  Image,
  Presentation,
  Table,
  Video,
} from "lucide-react";
import type { ReactNode } from "react";

function IconBadge({ bg, children }: { bg: string; children: ReactNode }) {
  return (
    <span
      className={`file-tree-icon-badge inline-flex size-[18px] shrink-0 items-center justify-center rounded-sm ${bg}`}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

export function FolderIcon({ open = false }: { open?: boolean }) {
  return (
    <IconBadge bg="bg-amber-400/15">
      {open ? (
        <FolderOpen className="size-[13px] text-[#f59e0b]" />
      ) : (
        <Folder className="size-[13px] text-[#eab308]" />
      )}
    </IconBadge>
  );
}

export function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";

  if (["js", "jsx"].includes(ext))
    return (
      <IconBadge bg="bg-yellow-400/15">
        <FileCode2 className="size-4 text-[#f0db4f]" />
      </IconBadge>
    );
  if (["ts", "tsx"].includes(ext))
    return (
      <IconBadge bg="bg-primary/15">
        <FileCode2 className="size-4 text-[#3178c6]" />
      </IconBadge>
    );
  if (["vue"].includes(ext))
    return (
      <IconBadge bg="bg-emerald-400/15">
        <Code className="size-4 text-[#42b883]" />
      </IconBadge>
    );
  if (["svelte"].includes(ext))
    return (
      <IconBadge bg="bg-orange-500/15">
        <Code className="size-4 text-[#ff3e00]" />
      </IconBadge>
    );
  if (["py"].includes(ext))
    return (
      <IconBadge bg="bg-blue-400/15">
        <Code className="size-4 text-[#3776ab]" />
      </IconBadge>
    );
  if (["rs"].includes(ext))
    return (
      <IconBadge bg="bg-orange-600/15">
        <Code className="size-4 text-[#ce422b]" />
      </IconBadge>
    );
  if (["go"].includes(ext))
    return (
      <IconBadge bg="bg-cyan-500/15">
        <Code className="size-4 text-[#00add8]" />
      </IconBadge>
    );
  if (["rb", "java", "c", "cpp", "h", "hpp"].includes(ext))
    return (
      <IconBadge bg="bg-red-500/15">
        <Code className="size-4 text-[#dc143c]" />
      </IconBadge>
    );
  if (["html", "htm"].includes(ext))
    return (
      <IconBadge bg="bg-orange-500/15">
        <Globe className="size-4 text-[#e34c26]" />
      </IconBadge>
    );
  if (["css", "scss", "sass", "less"].includes(ext))
    return (
      <IconBadge bg="bg-primary/15">
        <FileCode className="size-4 text-[#264de4]" />
      </IconBadge>
    );
  if (["json", "jsonc"].includes(ext))
    return (
      <IconBadge bg="bg-amber-500/15">
        <Braces className="size-4 text-[#f59e0b]" />
      </IconBadge>
    );
  if (["yaml", "yml"].includes(ext))
    return (
      <IconBadge bg="bg-purple-500/15">
        <FileText className="size-4 text-[#a855f7]" />
      </IconBadge>
    );
  if (["toml", "ini", "conf", "env"].includes(ext))
    return (
      <IconBadge bg="bg-slate-400/15">
        <FileText className="size-4 text-[#64748b]" />
      </IconBadge>
    );
  if (["xml"].includes(ext))
    return (
      <IconBadge bg="bg-green-500/15">
        <Code className="size-4 text-[#16a34a]" />
      </IconBadge>
    );
  if (["svg"].includes(ext))
    return (
      <IconBadge bg="bg-amber-400/15">
        <Image className="size-4 text-[#f59e0b]" />
      </IconBadge>
    );
  if (["md", "mdx"].includes(ext))
    return (
      <IconBadge bg="bg-blue-400/15">
        <FileText className="size-4 text-primary" />
      </IconBadge>
    );
  if (["mmd"].includes(ext))
    return (
      <IconBadge bg="bg-violet-400/15">
        <Braces className="size-4 text-[#8b5cf6]" />
      </IconBadge>
    );
  if (["txt"].includes(ext))
    return (
      <IconBadge bg="bg-slate-400/15">
        <FileText className="size-4 text-[#94a3b8]" />
      </IconBadge>
    );
  if (["pdf"].includes(ext))
    return (
      <IconBadge bg="bg-red-500/15">
        <FileText className="size-4 text-[#dc2626]" />
      </IconBadge>
    );
  if (["doc", "docx"].includes(ext))
    return (
      <IconBadge bg="bg-primary/15">
        <FileText className="size-4 text-[#2563eb]" />
      </IconBadge>
    );
  if (["xls", "xlsx", "csv"].includes(ext))
    return (
      <IconBadge bg="bg-emerald-500/15">
        <Table className="size-4 text-[#059669]" />
      </IconBadge>
    );
  if (["ppt", "pptx"].includes(ext))
    return (
      <IconBadge bg="bg-orange-500/15">
        <Presentation className="size-4 text-[#ea580c]" />
      </IconBadge>
    );
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"].includes(ext))
    return (
      <IconBadge bg="bg-purple-500/15">
        <Image className="size-4 text-[#a855f7]" />
      </IconBadge>
    );
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext))
    return (
      <IconBadge bg="bg-pink-500/15">
        <Video className="size-4 text-[#ec4899]" />
      </IconBadge>
    );
  if (["zip", "tar", "gz", "rar", "7z", "bz2"].includes(ext))
    return (
      <IconBadge bg="bg-amber-600/15">
        <Archive className="size-4 text-[#d97706]" />
      </IconBadge>
    );
  if (["db", "sqlite", "sql"].includes(ext))
    return (
      <IconBadge bg="bg-cyan-600/15">
        <Database className="size-4 text-[#0891b2]" />
      </IconBadge>
    );

  return (
    <IconBadge bg="bg-muted/80">
      <File className="size-4 text-[#9ca3af]" />
    </IconBadge>
  );
}
