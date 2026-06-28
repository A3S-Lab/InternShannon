import Mention from "@tiptap/extension-mention";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useReactive } from "ahooks";
import {
  forwardRef,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { FileIcon, FolderIcon } from "@/components/workspace/file-tree-editor/file-icons";
import { useKeyboardDispatcher } from "@/contexts/keyboard-dispatcher-context";
import { setActiveEditorType, useTiptapEditor } from "@/contexts/keyboard-dispatcher-provider";
/**
 * TipTap rich text editor with / slash-commands and @ mentions.
 */
import { cn } from "@/lib/utils";
import { workspaceApi } from "@/lib/workspace-api";
import { BashColorExtension, BashTextMark } from "./bash-color";
import type { SuggestionItem } from "./mention-list";
import { SlashCommand } from "./slash-command";
import { SlashCommandNode } from "./slash-node";
import {
  isTiptapSubmitPromise,
  shouldClearAfterTiptapSubmitResult,
  shouldHandleTiptapSubmitKey,
  shouldSubmitTiptapContent,
  type TiptapSubmitResult,
} from "./submit-state";
import { createSuggestionRenderer } from "./suggestion-renderer";
import "./tiptap.css";

// =============================================================================
// Data sources for / and @
// =============================================================================

/** Items available for @mention: workspace files only (no agents) */
const MENTION_ITEMS: SuggestionItem[] = [];

/**
 * Fetch workspace files and directories
 * Returns a list of files/folders in the current workspace
 */
async function fetchWorkspaceFiles(workspaceDir: string, group = "工作区"): Promise<SuggestionItem[]> {
  try {
    if (!workspaceDir) return [];

    const entries = await workspaceApi.readDir(workspaceDir);

    return entries
      .filter((entry) => {
        const name = entry.name || "";
        return (
          !name.startsWith(".") && name !== "node_modules" && name !== "target" && name !== "dist" && name !== "build"
        );
      })
      .map((entry) => ({
        id: `file:${workspaceDir}/${entry.name}`,
        label: entry.name || "",
        description: entry.isDirectory ? "文件夹" : "文件",
        group,
        path: `${workspaceDir}/${entry.name}`,
        isDirectory: entry.isDirectory,
        level: 0,
        expanded: false,
        icon: entry.isDirectory ? <FolderIcon /> : <FileIcon name={entry.name || ""} />,
      }))
      .slice(0, 20);
  } catch {
    return [];
  }
}

/**
 * Fetch files in a subdirectory
 */
async function fetchSubdirectoryFiles(dirPath: string, level: number): Promise<SuggestionItem[]> {
  try {
    const entries = await workspaceApi.readDir(dirPath);

    const filtered = entries.filter((entry) => {
      const name = entry.name || "";
      return (
        !name.startsWith(".") && name !== "node_modules" && name !== "target" && name !== "dist" && name !== "build"
      );
    });

    return filtered.map((entry) => ({
      id: `file:${dirPath}/${entry.name}`,
      label: entry.name || "",
      description: entry.isDirectory ? "文件夹" : "文件",
      group: "工作区",
      path: `${dirPath}/${entry.name}`,
      isDirectory: entry.isDirectory,
      level,
      expanded: false,
      icon: entry.isDirectory ? <FolderIcon /> : <FileIcon name={entry.name || ""} />,
    }));
  } catch (error) {
    console.error("[TiptapEditor] Failed to fetch subdirectory:", dirPath, error);
    return [];
  }
}

function filterItems(items: SuggestionItem[], query: string): SuggestionItem[] {
  const q = query.toLowerCase();
  if (!q) return items.slice(0, 50); // Increased limit to show more files and expanded folders
  return items
    .filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q),
    )
    .slice(0, 30); // Increased limit for search results
}

// =============================================================================
// Editor component
// =============================================================================

export interface TiptapEditorRef {
  focus: () => void;
  getText: () => string;
  clear: () => void;
  isEmpty: () => boolean;
  appendText: (text: string) => void;
  appendFileMentions: (
    files: Array<{
      path: string;
      label: string;
    }>,
  ) => void;
  setText: (text: string) => void;
  /** Returns ids of all @mentioned agents in the current content */
  getMentions: () => string[];
  getFileMentions: () => Array<{
    id: string;
    path: string;
    label: string;
    isDirectory: boolean;
  }>;
}

interface TiptapEditorProps {
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  disableSlash?: boolean;
  allowEmptySubmit?: boolean;
  onSubmit?: (text: string) => TiptapSubmitResult;
  onChange?: (text: string) => void;
  /** Called when images are pasted from clipboard */
  onPasteImages?: (images: { mediaType: string; data: string }[]) => void;
  /** Override @mention items (defaults to BUILTIN_AGENTS) */
  mentionItems?: SuggestionItem[];
  /** Slash command items fetched from the API */
  slashItems?: SuggestionItem[];
  /** Workspace directory for file mentions */
  workspaceDir?: string;
}

const TiptapEditor = forwardRef<TiptapEditorRef, TiptapEditorProps>(
  (
    {
      placeholder,
      ariaLabel,
      disabled,
      className,
      disableSlash,
      allowEmptySubmit,
      onSubmit,
      onChange,
      onPasteImages,
      mentionItems,
      slashItems,
      workspaceDir,
    },
    ref,
  ) => {
    const { dispatchKeyDown } = useKeyboardDispatcher();
    const dispatchRef = useRef<typeof dispatchKeyDown>(() => false);
    // Keep ref in sync with latest dispatcher (handleKeyDown captures dispatchRef)
    useEffect(() => {
      dispatchRef.current = dispatchKeyDown;
    });

    const state = useReactive({
      workspaceFiles: [] as SuggestionItem[],
      expandedFolders: new Set<string>(),
    });
    const workspaceDirRef = useRef<string>("");
    const editorAttributes = useMemo<Record<string, string>>(() => {
      const attributes: Record<string, string> = {
        class: "tiptap-content",
        role: "textbox",
        "aria-label": ariaLabel?.trim() || placeholder?.trim() || "输入消息",
        "aria-multiline": "true",
      };
      if (disabled) {
        attributes["aria-disabled"] = "true";
      }
      return attributes;
    }, [ariaLabel, disabled, placeholder]);

    const resolvedMentionItems = useMemo(() => {
      const baseItems = mentionItems ?? MENTION_ITEMS;
      return [...baseItems, ...state.workspaceFiles];
    }, [mentionItems, state.workspaceFiles]);

    // Load workspace files when workspaceDir changes
    useEffect(() => {
      workspaceDirRef.current = workspaceDir || "";
      if (workspaceDir) {
        fetchWorkspaceFiles(workspaceDir).then((files) => {
          state.workspaceFiles = files;
          state.expandedFolders = new Set();
        });
      } else {
        state.workspaceFiles = [];
        state.expandedFolders = new Set();
      }
    }, [workspaceDir, state]);

    // Refresh workspace files - called when @ panel opens
    const refreshWorkspaceFiles = useCallback(async () => {
      const dir = workspaceDirRef.current;
      if (dir) {
        const newFiles = await fetchWorkspaceFiles(dir);

        // Only update if the directory hasn't changed
        if (workspaceDirRef.current === dir) {
          // Get currently expanded folder paths
          const currentExpandedPaths = Array.from(state.expandedFolders);

          if (currentExpandedPaths.length === 0) {
            // No folders expanded, just return new files
            state.workspaceFiles = newFiles;
          } else {
            // Re-expand folders that were previously expanded
            // Build the complete list with expanded folders
            const result: SuggestionItem[] = [];

            for (const file of newFiles) {
              result.push(file);

              // If this folder was expanded, load and insert its children
              if (file.isDirectory && file.path && currentExpandedPaths.includes(file.path)) {
                const children = await fetchSubdirectoryFiles(file.path, (file.level || 0) + 1);

                // Mark folder as expanded
                result[result.length - 1] = { ...file, expanded: true };

                // Insert children
                result.push(...children);
              }
            }

            state.workspaceFiles = result;
          }
        }
      }
    }, [state]);

    // Handle folder expansion/collapse
    const handleFolderClick = useCallback(
      async (folder: SuggestionItem) => {
        if (!folder.path || !folder.isDirectory) return;

        const folderPath = folder.path;
        const currentlyExpanded = state.expandedFolders.has(folderPath);

        if (currentlyExpanded) {
          // Collapse
          state.expandedFolders.delete(folderPath);

          state.workspaceFiles = state.workspaceFiles
            .filter((item) => !item.path || !item.path.startsWith(`${folderPath}/`))
            .map((item) => (item.path === folderPath ? { ...item, expanded: false } : item));
        } else {
          // Expand
          const children = await fetchSubdirectoryFiles(folderPath, (folder.level || 0) + 1);

          state.expandedFolders.add(folderPath);

          state.workspaceFiles = (() => {
            const result: SuggestionItem[] = [];
            for (const item of state.workspaceFiles) {
              if (item.path === folderPath) {
                result.push({ ...item, expanded: true });
                result.push(...children);
              } else {
                result.push(item);
              }
            }
            return result;
          })();
        }
      },
      [state],
    );

    // Use a ref to store the latest handleFolderClick so the suggestion
    // closure always reads the latest callback without recreating the editor
    const handleFolderClickRef = useRef(handleFolderClick);
    useEffect(() => {
      handleFolderClickRef.current = handleFolderClick;
    }, [handleFolderClick]);

    // Use a ref for refreshWorkspaceFiles as well
    const refreshWorkspaceFilesRef = useRef(refreshWorkspaceFiles);
    useEffect(() => {
      refreshWorkspaceFilesRef.current = refreshWorkspaceFiles;
    }, [refreshWorkspaceFiles]);

    // Use refs so the suggestion closures always read the latest items
    // without needing to recreate the editor when items change.
    const slashItemsRef = useRef<SuggestionItem[]>(slashItems ?? []);
    useEffect(() => {
      slashItemsRef.current = slashItems ?? [];
    }, [slashItems]);

    const mentionItemsRef = useRef<SuggestionItem[]>(resolvedMentionItems);
    useEffect(() => {
      mentionItemsRef.current = resolvedMentionItems;
    }, [resolvedMentionItems]);

    // Guard: when a suggestion item is selected via Enter, keep that same
    // keydown cycle from also submitting the message.
    const justSelectedRef = useRef(false);
    const selectionGuardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const markSuggestionSelected = useCallback(() => {
      justSelectedRef.current = true;
      if (selectionGuardTimerRef.current !== null) {
        clearTimeout(selectionGuardTimerRef.current);
      }
      selectionGuardTimerRef.current = setTimeout(() => {
        justSelectedRef.current = false;
        selectionGuardTimerRef.current = null;
      }, 0);
    }, []);

    useEffect(() => {
      return () => {
        if (selectionGuardTimerRef.current !== null) {
          clearTimeout(selectionGuardTimerRef.current);
        }
      };
    }, []);

    // Track whether any suggestion menu is currently open
    const suggestionOpenRef = useRef(false);

    const slashSuggestion = useMemo(
      () =>
        createSuggestionRenderer(
          (q) => filterItems(slashItemsRef.current, q),
          markSuggestionSelected,
          undefined,
          undefined,
          suggestionOpenRef,
        ),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [markSuggestionSelected],
    );

    const mentionSuggestion = useMemo(
      () =>
        createSuggestionRenderer(
          (q) => {
            const items = filterItems(mentionItemsRef.current, q);
            return items;
          },
          markSuggestionSelected,
          (item) => handleFolderClickRef.current(item),
          () => refreshWorkspaceFilesRef.current(),
          suggestionOpenRef,
          true, // enableSearch
          workspaceDirRef,
        ),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [markSuggestionSelected],
    );

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          // Disable block-level features — this is a chat input, not a document editor
          heading: false,
          blockquote: false,
          codeBlock: false,
          horizontalRule: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
        }),
        Placeholder.configure({
          placeholder: placeholder || "输入消息... (/ 命令 · @ 文件 · ! bash)",
          emptyEditorClass: "tiptap-empty",
        }),
        Mention.configure({
          HTMLAttributes: {
            class: "tiptap-mention",
          },
          renderHTML({ options, node }) {
            return ["span", options.HTMLAttributes, `@${node.attrs.label ?? node.attrs.id}`];
          },
          suggestion: {
            char: "@",
            ...mentionSuggestion,
          },
        }),
        BashTextMark,
        BashColorExtension,
        ...(!disableSlash
          ? [
              SlashCommandNode,
              SlashCommand.configure({
                suggestion: {
                  ...slashSuggestion,
                },
              }),
            ]
          : []),
      ],
      editable: !disabled,
      editorProps: {
        attributes: editorAttributes,
        handlePaste: (_view, event) => {
          const items = event.clipboardData?.items;
          if (!items || !onPasteImages) return false;
          const imageFiles: File[] = [];
          for (const item of Array.from(items)) {
            if (item.type.startsWith("image/")) {
              const file = item.getAsFile();
              if (file) imageFiles.push(file);
            }
          }
          if (imageFiles.length === 0) return false;
          event.preventDefault();
          Promise.all(
            imageFiles.map(
              (file) =>
                new Promise<{ mediaType: string; data: string }>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => {
                    const result = reader.result as string;
                    const [header, data] = result.split(",");
                    const mediaType = header.replace("data:", "").replace(";base64", "");
                    resolve({ mediaType, data });
                  };
                  reader.onerror = reject;
                  reader.readAsDataURL(file);
                }),
            ),
          ).then(onPasteImages);
          return true;
        },
        handleKeyDown: (_view, event) => {
          // Let the keyboard dispatcher try to handle the shortcut first.
          // If it returns true, the shortcut was matched and consumed.
          if (
            dispatchRef.current(event, {
              editorId: "tiptap-main",
            })
          ) {
            return true;
          }
          // Plain Enter submits here; modified shortcuts are owned by the input shell.
          if (shouldHandleTiptapSubmitKey(event)) {
            // Don't submit if suggestion menu is open
            if (suggestionOpenRef.current) {
              return false; // Let suggestion plugin handle it
            }
            // Don't submit if a suggestion was just selected via Enter
            if (justSelectedRef.current) {
              justSelectedRef.current = false;
              return true;
            }
            event.preventDefault();
            const text = editor?.getText().trim() ?? "";
            if (shouldSubmitTiptapContent({ text, allowEmptySubmit })) {
              const clearAfterSubmit = () => {
                // Clear after a microtask to avoid interfering with ProseMirror.
                setTimeout(() => {
                  editor?.commands.clearContent();
                  editor?.commands.focus();
                }, 0);
              };
              const submitResult = onSubmit?.(text);
              if (isTiptapSubmitPromise(submitResult)) {
                void Promise.resolve(submitResult)
                  .then((accepted) => {
                    if (shouldClearAfterTiptapSubmitResult(accepted)) clearAfterSubmit();
                  })
                  .catch(() => undefined);
              } else if (shouldClearAfterTiptapSubmitResult(submitResult)) {
                clearAfterSubmit();
              }
              return true;
            }
            return false;
          }
          return false;
        },
      },
      onUpdate: ({ editor: e }) => {
        onChange?.(e.getText());
      },
    });

    useEffect(() => {
      editor?.setOptions({
        editorProps: {
          ...editor.options.editorProps,
          attributes: editorAttributes,
        },
      });
    }, [editor, editorAttributes]);

    // Sync disabled state
    useEffect(() => {
      if (editor) {
        editor.setEditable(!disabled);
      }
    }, [editor, disabled]);

    // Register this TipTap editor with the keyboard dispatcher
    useTiptapEditor("tiptap-main", editor);

    // Set TipTap as the active editor type for keyboard shortcuts
    useEffect(() => {
      setActiveEditorType("tiptap");
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => editor?.commands.focus(),
        getText: () => {
          if (!editor) return "";
          // Override mention serialization: file mentions output "@/absolute/path"
          // so the full path reaches the LLM without starting with "/" (which
          // would trigger a slash command in a3s-code).
          return editor.getText({
            textSerializers: {
              mention: ({ node }: { node: { attrs: Record<string, unknown> } }) => {
                const id = node.attrs.id as string;
                if (id?.startsWith("file:")) {
                  return `@${id.slice("file:".length)}`;
                }
                return `@${(node.attrs.label as string) ?? id}`;
              },
            },
          });
        },
        clear: () => editor?.commands.clearContent(),
        isEmpty: () => editor?.isEmpty ?? true,
        appendText: (text: string) => {
          if (!editor || !text) return;
          editor.commands.focus();
          editor.commands.insertContent(text);
        },
        appendFileMentions: (files) => {
          if (!editor || files.length === 0) return;
          const currentText = editor.getText();
          const content: Array<{
            type: string;
            text?: string;
            attrs?: Record<string, unknown>;
          }> = [];
          if (currentText.trim() && !/\s$/.test(currentText)) {
            content.push({ type: "text", text: " " });
          }
          for (const file of files) {
            content.push({
              type: "mention",
              attrs: {
                id: `file:${file.path}`,
                label: file.label,
              },
            });
            content.push({ type: "text", text: " " });
          }
          editor.chain().focus("end").insertContent(content).run();
        },
        setText: (text: string) => {
          if (!editor) return;
          editor.commands.focus();
          editor.commands.clearContent();
          if (text) {
            editor.commands.insertContent(text);
          }
        },
        getMentions: () => {
          if (!editor) return [];
          const ids: string[] = [];
          editor.state.doc.descendants((node) => {
            if (node.type.name === "mention") {
              ids.push(node.attrs.id as string);
            }
          });
          return ids;
        },
        getFileMentions: () => {
          if (!editor) return [];
          const files: Array<{
            id: string;
            path: string;
            label: string;
            isDirectory: boolean;
          }> = [];
          editor.state.doc.descendants((node) => {
            if (node.type.name !== "mention") return;
            const id = String(node.attrs.id || "");
            if (!id.startsWith("file:")) return;
            files.push({
              id,
              path: id.slice("file:".length),
              label: String(node.attrs.label || ""),
              isDirectory: Boolean(node.attrs.isDirectory),
            });
          });
          return files;
        },
      }),
      [editor],
    );

    const handleContainerClick = useCallback(() => {
      editor?.commands.focus();
    }, [editor]);

    const handleContainerKeyDown = useCallback(
      (event: ReactKeyboardEvent<HTMLFieldSetElement>) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        editor?.commands.focus();
      },
      [editor],
    );

    return (
      <fieldset
        className={cn("m-0 min-w-0 border-0 p-0 w-full h-full overflow-y-auto cursor-text", className)}
        onClick={handleContainerClick}
        onKeyDown={handleContainerKeyDown}
        aria-label={editorAttributes["aria-label"]}
      >
        <EditorContent editor={editor} className="h-full" />
      </fieldset>
    );
  },
);

TiptapEditor.displayName = "TiptapEditor";

export default TiptapEditor;
