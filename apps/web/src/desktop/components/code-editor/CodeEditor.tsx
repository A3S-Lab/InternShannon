import { Editor, EditorProps, Monaco } from "@monaco-editor/react";
import { useTheme } from "@/components/custom/theme-provider";
import settingsModel from "@/models/settings.model";
import { useEffect, useRef } from "react";
import { useReactive } from "ahooks";
import { useSnapshot } from "valtio";
import ThemeOneDarkPro from "./themes/onedarkpro.json";
import type * as monacoEditor from "monaco-editor";
import { applyKeybindings } from "./keybindings";
import { setActiveEditorType } from "@/contexts/keyboard-dispatcher-provider";

export default function CodeEditor(props: EditorProps) {
  const { theme: appTheme } = useTheme();
  const { editorSettings } = useSnapshot(settingsModel.state);

  const editorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const kbDisposablesRef = useRef<monacoEditor.IDisposable[]>([]);
  const focusDisposablesRef = useRef<monacoEditor.IDisposable[]>([]);

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

  const getMonacoTheme = () => {
    if (appTheme === "dark") return "one-dark-pro";
    if (appTheme === "light") return "vs";
    const isDark = document.documentElement.classList.contains("dark");
    return isDark ? "one-dark-pro" : "vs";
  };

  const state = useReactive({ editorTheme: getMonacoTheme() });

  useEffect(() => {
    state.editorTheme = getMonacoTheme();
  }, [appTheme]);

  useEffect(() => {
    if (appTheme !== "system") return;
    const observer = new MutationObserver(() => (state.editorTheme = getMonacoTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [appTheme]);

  // ---------------------------------------------------------------------------
  // Keybindings — re-apply when settings change
  // ---------------------------------------------------------------------------

  const kbKey = JSON.stringify(editorSettings.keybindings);

  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;
    for (const d of kbDisposablesRef.current) d.dispose();
    kbDisposablesRef.current = applyKeybindings(
      editorRef.current,
      monacoRef.current,
      settingsModel.state.editorSettings.keybindings,
    );
  }, [kbKey]);

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
  });

  useEffect(() => {
    // editorRef.current is null on first render (before mount),
    // so this effect only runs after the editor is mounted and settings change.
    if (!editorRef.current) return;

    editorRef.current.updateOptions({
      fontFamily: editorSettings.fontFamily,
      fontSize: editorSettings.fontSize,
      fontLigatures: editorSettings.fontLigatures,
      tabSize: editorSettings.tabSize,
      insertSpaces: editorSettings.insertSpaces,
      detectIndentation: editorSettings.detectIndentation,
      wordWrap: editorSettings.wordWrap,
      wordWrapColumn: editorSettings.wordWrapColumn,
      minimap: { enabled: editorSettings.minimap },
      lineNumbers: editorSettings.lineNumbers,
      renderWhitespace: editorSettings.renderWhitespace,
      cursorStyle: editorSettings.cursorStyle,
      cursorBlinking: editorSettings.cursorBlinking,
      formatOnPaste: editorSettings.formatOnPaste,
      bracketPairColorization: {
        enabled: editorSettings.bracketPairColorization,
      },
      stickyScroll: { enabled: editorSettings.stickyScroll },
      contextmenu: editorSettings.contextmenu,
      codeLens: editorSettings.codeLens,
      showFoldingControls: editorSettings.showFoldingControls,
      glyphMargin: editorSettings.glyphMargin,
      colorDecorators: editorSettings.colorDecorators,
      renderLineHighlight: editorSettings.renderLineHighlight,
      matchBrackets: editorSettings.matchBrackets,
    });
  }, [editorOptionsKey]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleBeforeMount(monaco: Monaco) {
    monaco.editor.defineTheme("one-dark-pro", {
      base: "vs-dark",
      inherit: true,
      rules: [...ThemeOneDarkPro.rules],
      encodedTokensColors: [...ThemeOneDarkPro.encodedTokensColors],
      colors: { ...ThemeOneDarkPro.colors },
    });
    monacoRef.current = monaco;
    props.beforeMount?.(monaco);
  }

  function handleEditorMount(editor: monacoEditor.editor.IStandaloneCodeEditor, monaco: Monaco) {
    editorRef.current = editor;
    monacoRef.current = monaco;
    for (const d of focusDisposablesRef.current) {
      if (d && typeof d.dispose === "function") {
        d.dispose();
      }
    }
    focusDisposablesRef.current = [
      editor.onDidFocusEditorText(() => setActiveEditorType("monaco")),
      editor.onDidFocusEditorWidget(() => setActiveEditorType("monaco")),
    ];

    // Dispose old keybinding disposables (guard against malformed items)
    for (const d of kbDisposablesRef.current) {
      if (d && typeof d.dispose === "function") {
        d.dispose();
      }
    }
    kbDisposablesRef.current = applyKeybindings(editor, monaco, settingsModel.state.editorSettings.keybindings).filter(
      (d): d is monacoEditor.IDisposable => d != null && typeof d.dispose === "function",
    );

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
      theme={state.editorTheme}
      height="100%"
      beforeMount={handleBeforeMount}
      onMount={handleEditorMount}
      options={mergedOptions}
    />
  );
}
