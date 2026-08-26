import { Editor, EditorProps, Monaco } from "@monaco-editor/react";
import settingsModel from "@/models/settings.model";
import { useEffect, useRef } from "react";
import { useSnapshot } from "valtio";
import type * as monacoEditor from "monaco-editor";
import { applyKeybindings } from "./keybindings";
import { setActiveEditorType } from "@/contexts/keyboard-dispatcher-provider";

interface CodeEditorProps extends EditorProps {
  /** Commands implemented by the surrounding file panel instead of Monaco's generic dispatcher. */
  hostOwnedCommandIds?: readonly string[];
}

const INTERN_SHANNON_LIGHT_THEME = "internshannon-light";

const MARKDOWN_TOKEN_RULES = [
  { token: "keyword", foreground: "1456F0", fontStyle: "bold" },
  { token: "strong", foreground: "7C3AED", fontStyle: "bold" },
  { token: "emphasis", foreground: "7C3AED", fontStyle: "italic" },
  { token: "variable", foreground: "B45309" },
  { token: "string", foreground: "047857" },
  { token: "comment", foreground: "64748B", fontStyle: "italic" },
  { token: "tag", foreground: "BE123C" },
];

export default function CodeEditor({ hostOwnedCommandIds, ...props }: CodeEditorProps) {
  const { editorSettings } = useSnapshot(settingsModel.state);

  const editorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const kbDisposablesRef = useRef<monacoEditor.IDisposable[]>([]);
  const focusDisposablesRef = useRef<monacoEditor.IDisposable[]>([]);
  const editorSettingsRef = useRef(editorSettings);
  const callerOptionsRef = useRef(props.options);
  editorSettingsRef.current = editorSettings;
  callerOptionsRef.current = props.options;

  // Dispose Monaco editor on unmount — prevents TextModel disposal errors
  // when the editor is closed while DiffEditorWidget still holds model references.
  useEffect(() => {
    return () => {
      // Dispose keybinding disposables (guard against malformed items)
      for (const d of kbDisposablesRef.current) {
        if (d && typeof d.dispose === "function") {
          d.dispose();
        }
      }
      kbDisposablesRef.current = [];
      for (const d of focusDisposablesRef.current) {
        if (d && typeof d.dispose === "function") {
          d.dispose();
        }
      }
      focusDisposablesRef.current = [];
      // Dispose the Monaco editor itself — guard against RxJS errors during disposal
      // (Monaco internally uses RxJS and may throw EmptyError during disposal)
      try {
        editorRef.current?.dispose();
      } catch {
        // Ignore disposal errors
      }
      editorRef.current = null;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------------

  const editorTheme = INTERN_SHANNON_LIGHT_THEME;

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const language = props.language || "plaintext";
    const model = editor.getModel();
    if (model && model.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(model, language);
    }
    monaco.editor.setTheme(editorTheme);
    const domNode = editor.getDomNode();
    if (domNode) {
      domNode.dataset.monacoLanguage = model?.getLanguageId() ?? language;
      domNode.dataset.monacoTheme = editorTheme;
    }
  }, [props.language]);

  // ---------------------------------------------------------------------------
  // Keybindings — re-apply when settings change
  // ---------------------------------------------------------------------------

  const kbKey = JSON.stringify(editorSettings.keybindings);
  const hostOwnedCommandKey = JSON.stringify(hostOwnedCommandIds ?? []);

  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;
    // These serialized values are the intentional change detectors. Read the
    // current model only after either fingerprint changes.
    void kbKey;
    const excludedCommandIds = JSON.parse(hostOwnedCommandKey) as string[];
    for (const d of kbDisposablesRef.current) d.dispose();
    kbDisposablesRef.current = applyKeybindings(
      editorRef.current,
      monacoRef.current,
      settingsModel.state.editorSettings.keybindings,
      { excludedCommandIds },
    );
  }, [kbKey, hostOwnedCommandKey]);

  // ---------------------------------------------------------------------------
  // Editor options — update when settings change (after mount)
  // ---------------------------------------------------------------------------

  // Serialize relevant settings to detect changes
  const editorOptionsKey = JSON.stringify({
    fontFamily: editorSettings.fontFamily,
    fontSize: editorSettings.fontSize,
    fontLigatures: editorSettings.fontLigatures,
    tabSize: editorSettings.tabSize,
    insertSpaces: editorSettings.insertSpaces,
    detectIndentation: editorSettings.detectIndentation,
    wordWrap: editorSettings.wordWrap,
    wordWrapColumn: editorSettings.wordWrapColumn,
    minimap: editorSettings.minimap,
    lineNumbers: editorSettings.lineNumbers,
    renderWhitespace: editorSettings.renderWhitespace,
    cursorStyle: editorSettings.cursorStyle,
    cursorBlinking: editorSettings.cursorBlinking,
    formatOnPaste: editorSettings.formatOnPaste,
    bracketPairColorization: editorSettings.bracketPairColorization,
    stickyScroll: editorSettings.stickyScroll,
    contextmenu: editorSettings.contextmenu,
    codeLens: editorSettings.codeLens,
    showFoldingControls: editorSettings.showFoldingControls,
    glyphMargin: editorSettings.glyphMargin,
    colorDecorators: editorSettings.colorDecorators,
    renderLineHighlight: editorSettings.renderLineHighlight,
    matchBrackets: editorSettings.matchBrackets,
    callerOptions: props.options,
  });

  useEffect(() => {
    // editorRef.current is null on first render (before mount),
    // so this effect only runs after the editor is mounted and settings change.
    if (!editorRef.current) return;
    void editorOptionsKey;
    const currentSettings = editorSettingsRef.current;

    editorRef.current.updateOptions({
      fontFamily: currentSettings.fontFamily,
      fontSize: currentSettings.fontSize,
      fontLigatures: currentSettings.fontLigatures,
      tabSize: currentSettings.tabSize,
      insertSpaces: currentSettings.insertSpaces,
      detectIndentation: currentSettings.detectIndentation,
      wordWrap: currentSettings.wordWrap,
      wordWrapColumn: currentSettings.wordWrapColumn,
      minimap: { enabled: currentSettings.minimap },
      lineNumbers: currentSettings.lineNumbers,
      renderWhitespace: currentSettings.renderWhitespace,
      cursorStyle: currentSettings.cursorStyle,
      cursorBlinking: currentSettings.cursorBlinking,
      formatOnPaste: currentSettings.formatOnPaste,
      bracketPairColorization: {
        enabled: currentSettings.bracketPairColorization,
      },
      stickyScroll: { enabled: currentSettings.stickyScroll },
      contextmenu: currentSettings.contextmenu,
      codeLens: currentSettings.codeLens,
      showFoldingControls: currentSettings.showFoldingControls,
      glyphMargin: currentSettings.glyphMargin,
      colorDecorators: currentSettings.colorDecorators,
      renderLineHighlight: currentSettings.renderLineHighlight,
      matchBrackets: currentSettings.matchBrackets,
      // Callers use this for surface-specific safety/compatibility settings.
      // Keep these values authoritative after mount as well as during mount.
      ...callerOptionsRef.current,
    });
  }, [editorOptionsKey]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleBeforeMount(monaco: Monaco) {
    monaco.editor.defineTheme(INTERN_SHANNON_LIGHT_THEME, {
      base: "vs",
      inherit: true,
      rules: MARKDOWN_TOKEN_RULES,
      colors: {
        "editor.background": "#FFFFFF",
        "editor.foreground": "#202124",
        "editor.selectionBackground": "#B9D4FFCC",
        "editor.inactiveSelectionBackground": "#B9D4FF80",
        "editor.selectionHighlightBackground": "#B9D4FF66",
        "editorCursor.foreground": "#1456F0",
        "editorLineNumber.foreground": "#6B7280",
        "editorLineNumber.activeForeground": "#1F2937",
      },
    });
    monacoRef.current = monaco;
    props.beforeMount?.(monaco);
  }

  function handleEditorMount(editor: monacoEditor.editor.IStandaloneCodeEditor, monaco: Monaco) {
    editorRef.current = editor;
    monacoRef.current = monaco;

    const reassertRuntimePresentation = () => {
      const language = props.language || "plaintext";
      const model = editor.getModel();
      if (model && model.getLanguageId() !== language) {
        monaco.editor.setModelLanguage(model, language);
      }
      // Monaco themes are process-global. A diff/YAML editor can change the
      // theme after this editor mounted, so reclaim it whenever this editor is
      // mounted or focused instead of trusting the React prop alone.
      monaco.editor.setTheme(editorTheme);
      const domNode = editor.getDomNode();
      if (domNode) {
        domNode.dataset.monacoLanguage = model?.getLanguageId() ?? language;
        domNode.dataset.monacoTheme = editorTheme;
      }
    };
    reassertRuntimePresentation();
    for (const d of focusDisposablesRef.current) {
      if (d && typeof d.dispose === "function") {
        d.dispose();
      }
    }
    focusDisposablesRef.current = [
      editor.onDidFocusEditorText(() => {
        setActiveEditorType("monaco");
        reassertRuntimePresentation();
      }),
      editor.onDidFocusEditorWidget(() => {
        setActiveEditorType("monaco");
        reassertRuntimePresentation();
      }),
    ];

    // Dispose old keybinding disposables (guard against malformed items)
    for (const d of kbDisposablesRef.current) {
      if (d && typeof d.dispose === "function") {
        d.dispose();
      }
    }
    kbDisposablesRef.current = applyKeybindings(
      editor,
      monaco,
      settingsModel.state.editorSettings.keybindings,
      { excludedCommandIds: hostOwnedCommandIds },
    ).filter((d): d is monacoEditor.IDisposable => d != null && typeof d.dispose === "function");

    props.onMount?.(editor, monaco);
  }

  // Merge caller's options with our defaults (caller wins on individual keys)
  const mergedOptions = {
    // Font
    fontFamily: editorSettings.fontFamily,
    fontSize: editorSettings.fontSize,
    fontLigatures: editorSettings.fontLigatures,
    // Indentation
    tabSize: editorSettings.tabSize,
    insertSpaces: editorSettings.insertSpaces,
    detectIndentation: editorSettings.detectIndentation,
    // Display
    wordWrap: editorSettings.wordWrap,
    wordWrapColumn: editorSettings.wordWrapColumn,
    minimap: { enabled: editorSettings.minimap },
    lineNumbers: editorSettings.lineNumbers,
    renderWhitespace: editorSettings.renderWhitespace,
    // Cursor & Selection
    cursorStyle: editorSettings.cursorStyle,
    cursorBlinking: editorSettings.cursorBlinking,
    // Editing behavior
    formatOnPaste: editorSettings.formatOnPaste,
    bracketPairColorization: {
      enabled: editorSettings.bracketPairColorization,
    },
    stickyScroll: { enabled: editorSettings.stickyScroll },
    // Context menu & CodeLens
    contextmenu: editorSettings.contextmenu,
    codeLens: editorSettings.codeLens,
    // Monaco-specific display
    showFoldingControls: editorSettings.showFoldingControls,
    glyphMargin: editorSettings.glyphMargin,
    colorDecorators: editorSettings.colorDecorators,
    renderLineHighlight: editorSettings.renderLineHighlight,
    matchBrackets: editorSettings.matchBrackets,
    // Suggest widget (always hide fields and functions for cleaner UX)
    suggest: { showFields: false, showFunctions: false },
    ...props.options,
  };

  return (
    // Spread caller props first, then override onMount/beforeMount so our
    // interceptors always run (they internally call props.onMount/beforeMount).
    <Editor
      {...props}
      theme={editorTheme}
      height="100%"
      beforeMount={handleBeforeMount}
      onMount={handleEditorMount}
      options={mergedOptions}
    />
  );
}
