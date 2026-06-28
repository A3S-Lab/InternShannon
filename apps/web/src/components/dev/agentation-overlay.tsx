import type { AgentationProps } from "agentation";
import React from "react";
import { toast } from "sonner";
import { isAgentationEnabled } from "@/lib/agentation-flag";

const Agentation = React.lazy(async () => {
  const module = await import("agentation");
  return { default: module.Agentation as React.ComponentType<AgentationProps> };
});

function copyWithHiddenTextarea(value: string): boolean {
  if (typeof document === "undefined" || !document.body) return false;

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.padding = "0";
  textarea.style.border = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  const selection = document.getSelection();
  const ranges: Range[] = [];
  if (selection) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      ranges.push(selection.getRangeAt(index).cloneRange());
    }
  }

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
}

async function copyFeedbackToClipboard(markdown: string): Promise<boolean> {
  if (!markdown.trim()) return false;

  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(markdown);
      return true;
    } catch {
      // Fall through to execCommand for HTTP/Tilt or stricter browser policies.
    }
  }

  return copyWithHiddenTextarea(markdown);
}

export function AgentationOverlay() {
  const handleCopy = React.useCallback((markdown: string) => {
    void copyFeedbackToClipboard(markdown).then((copied) => {
      if (copied) {
        toast.success("Agentation Feedback 已复制");
        return;
      }
      toast.error(markdown.trim() ? "浏览器阻止了剪贴板写入" : "没有可复制的 Feedback 内容");
    });
  }, []);

  if (!isAgentationEnabled(import.meta.env.PUBLIC_ENABLE_AGENTATION)) {
    return null;
  }

  return (
    <React.Suspense fallback={null}>
      <Agentation copyToClipboard={false} onCopy={handleCopy} />
    </React.Suspense>
  );
}
