/**
 * Inline inputs - rename and creation inputs for file tree
 */
import { useEventListener, useReactive } from "ahooks";
import { useCallback, useEffect, useRef } from "react";

// ── Inline Rename Input ─────────────────────────────────────────────────────────

export function InlineRenameInput({
  initialValue,
  isDirectory,
  onConfirm,
  onCancel,
}: {
  initialValue: string;
  isDirectory: boolean;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}) {
  const state = useReactive({
    value: initialValue,
    selection: (isDirectory ? "all" : "prefix") as "prefix" | "all" | "suffix",
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const dotIndex = isDirectory ? -1 : initialValue.lastIndexOf(".");

  const applySelection = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;

    if (state.selection === "all") {
      input.setSelectionRange(0, state.value.length);
      return;
    }

    if (state.selection === "prefix") {
      input.setSelectionRange(0, dotIndex > 0 ? dotIndex : state.value.length);
      return;
    }

    input.setSelectionRange(
      dotIndex > 0 ? dotIndex + 1 : 0,
      state.value.length
    );
  }, [dotIndex, state]);

  useEffect(() => {
    inputRef.current?.focus();
    applySelection();
  }, [applySelection]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();

    if (e.key === "Enter") {
      e.preventDefault();
      onConfirm(state.value);
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }

    if (e.key === "F2") {
      e.preventDefault();
      state.selection =
        state.selection === "prefix"
          ? "all"
          : state.selection === "all"
          ? "suffix"
          : "prefix";
      setTimeout(applySelection, 0);
    }
  };

  // Auto-save on click outside
  useEventListener("pointerdown", (e) => {
    if (!inputRef.current || inputRef.current.contains(e.target as Node))
      return;

    if (state.value.trim()) {
      onConfirm(state.value.trim());
      return;
    }

    onCancel();
  });

  return (
    <input
      ref={inputRef}
      aria-label={isDirectory ? "重命名文件夹" : "重命名文件"}
      autoComplete="off"
      data-tree-inline-input="true"
      spellCheck={false}
      value={state.value}
      onChange={(e) => {
        state.value = e.target.value;
      }}
      onKeyDown={handleKeyDown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="file-tree-inline-text-input h-5 px-1 text-[13px] border border-primary rounded-sm bg-background w-full max-w-[200px]"
    />
  );
}

// ── Inline Creation Input ──────────────────────────────────────────────────────

export function InlineCreationInput({
  isFolder,
  onConfirm,
  onCancel,
}: {
  isFolder: boolean;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const state = useReactive({ value: "" });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();

    if (e.key === "Enter") {
      e.preventDefault();
      const name = state.value.trim();
      if (name) {
        onConfirm(name);
      } else {
        onCancel();
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  // Auto-confirm on click outside
  useEventListener("pointerdown", (e) => {
    if (!inputRef.current || inputRef.current.contains(e.target as Node))
      return;

    const name = state.value.trim();
    if (name) {
      onConfirm(name);
      return;
    }

    onCancel();
  });

  return (
    <input
      ref={inputRef}
      aria-label={isFolder ? "新建文件夹名称" : "新建文件名称"}
      autoComplete="off"
      data-tree-inline-input="true"
      spellCheck={false}
      value={state.value}
      onChange={(e) => {
        state.value = e.target.value;
      }}
      onKeyDown={handleKeyDown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      placeholder={isFolder ? "文件夹名称" : "文件名称"}
      className="file-tree-inline-text-input h-5 px-1 text-[13px] border border-primary rounded-sm bg-background w-full max-w-[200px]"
    />
  );
}
