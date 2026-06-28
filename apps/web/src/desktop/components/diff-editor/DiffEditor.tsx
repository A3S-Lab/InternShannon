/**
 * DiffEditor — Monaco-based visual diff editor.
 * Features:
 * - Side-by-side diff view
 * - Inline diff view
 * - Syntax highlighting
 * - Navigate between changes
 */

import {
	DiffEditor as MonacoDiffEditor,
	DiffEditorProps,
} from "@monaco-editor/react";
import { useTheme } from "@/components/custom/theme-provider";
import settingsModel from "@/models/settings.model";
import { useEffect, useRef } from "react";
import { useReactive } from "ahooks";
import { useSnapshot } from "valtio";
import ThemeOneDarkPro from "../code-editor/themes/onedarkpro.json";
import type * as monacoEditor from "monaco-editor";

export interface DiffEditorPanelProps {
	originalContent: string;
	modifiedContent: string;
	originalLanguage?: string;
	modifiedLanguage?: string;
	originalUri?: string;
	modifiedUri?: string;
	onOriginalChange?: (value: string) => void;
	onModifiedChange?: (value: string) => void;
	readOnly?: boolean;
}

export function DiffEditorPanel({
	originalContent,
	modifiedContent,
	originalLanguage = "plaintext",
	modifiedLanguage = "plaintext",
	originalUri: _originalUri,
	modifiedUri: _modifiedUri,
	readOnly = false,
}: DiffEditorPanelProps) {
	const { theme: appTheme } = useTheme();
	const { editorSettings } = useSnapshot(settingsModel.state);
	const editorRef = useRef<monacoEditor.editor.IStandaloneDiffEditor | null>(
		null,
	);
	const monacoRef = useRef<any>(null);

	// Dispose editor on unmount
	useEffect(() => {
		return () => {
			try {
				editorRef.current?.dispose();
			} catch {
				// Ignore disposal errors
			}
			editorRef.current = null;
		};
	}, []);

	// Theme
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
		const observer = new MutationObserver(
			() => (state.editorTheme = getMonacoTheme()),
		);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});
		return () => observer.disconnect();
	}, [appTheme]);

	function handleBeforeMount(monaco: any) {
		monaco.editor.defineTheme("one-dark-pro", {
			base: "vs-dark",
			inherit: true,
			rules: [...ThemeOneDarkPro.rules],
			encodedTokensColors: [...ThemeOneDarkPro.encodedTokensColors],
			colors: { ...ThemeOneDarkPro.colors },
		});
		monacoRef.current = monaco;
	}

	function handleEditorMount(
		editor: monacoEditor.editor.IStandaloneDiffEditor,
		monaco: any,
	) {
		editorRef.current = editor;
		monacoRef.current = monaco;

		// Navigate to first change
		goToNextChange(editor, -1);
	}

	function goToNextChange(
		editor: monacoEditor.editor.IStandaloneDiffEditor,
		_direction: number,
	) {
		const modifiedEditor = editor.getModifiedEditor();
		const diffModel = editor.getModel();
		if (!diffModel) return;

		// @ts-ignore - getChanges exists on Monaco diff model
		const diffChanges = diffModel.getChanges();
		if (diffChanges.length === 0) return;

		// Get current cursor position
		const position = modifiedEditor.getPosition();
		if (!position) {
			// Go to first change
			modifiedEditor.setPosition({
				lineNumber: diffChanges[0].modifiedStartLineNumber,
				column: 1,
			});
			return;
		}

		// Find the next change after current position
		const currentLine = position.lineNumber;
		let targetChange = diffChanges.find(
			(change: any) => change.modifiedEndLineNumber > currentLine,
		);

		if (!targetChange) {
			// Wrap around to first change
			targetChange = diffChanges[0];
		}

		if (targetChange) {
			modifiedEditor.setPosition({
				lineNumber: targetChange.modifiedStartLineNumber,
				column: 1,
			});
		}
	}

	// Merge options with user settings
	const mergedOptions: monacoEditor.editor.IDiffEditorOptions = {
		readOnly,
		fontFamily: editorSettings.fontFamily,
		fontSize: editorSettings.fontSize,
		fontLigatures: editorSettings.fontLigatures,
		minimap: { enabled: editorSettings.minimap },
		scrollBeyondLastLine: false,
		automaticLayout: true,
		enableSplitViewResizing: true,
		// Diff options
		ignoreTrimWhitespace: false,
		renderSideBySide: true,
		diffWordWrap: (editorSettings.wordWrap === "on" ? "on" : "off") as
			| "off"
			| "on"
			| "inherit",
		...({} as DiffEditorProps["options"]),
	};

	return (
		<MonacoDiffEditor
			original={originalContent}
			modified={modifiedContent}
			originalLanguage={originalLanguage}
			modifiedLanguage={modifiedLanguage}
			theme={state.editorTheme}
			height="100%"
			beforeMount={handleBeforeMount}
			onMount={handleEditorMount}
			options={mergedOptions}
		/>
	);
}

// Simplified hook for common diff operations
export function useDiffEditor() {
	const goToNextChange = (
		editor: monacoEditor.editor.IStandaloneDiffEditor | null,
	) => {
		if (!editor) return;
		const modifiedEditor = editor.getModifiedEditor();
		const diffModel = editor.getModel();
		if (!diffModel) return;

		// @ts-ignore - getChanges exists on Monaco diff model
		const diffChanges: any[] = diffModel.getChanges();
		if (diffChanges.length === 0) return;

		const position = modifiedEditor.getPosition();
		const currentLine = position?.lineNumber ?? 0;

		let targetChange = diffChanges.find(
			(change: any) => change.modifiedEndLineNumber > currentLine,
		);

		if (!targetChange && diffChanges.length > 0) {
			targetChange = diffChanges[0];
		}

		if (targetChange) {
			modifiedEditor.setPosition({
				lineNumber: targetChange.modifiedStartLineNumber,
				column: 1,
			});
			modifiedEditor.revealLineInCenter(targetChange.modifiedStartLineNumber);
		}
	};

	const goToPrevChange = (
		editor: monacoEditor.editor.IStandaloneDiffEditor | null,
	) => {
		if (!editor) return;
		const modifiedEditor = editor.getModifiedEditor();
		const diffModel = editor.getModel();
		if (!diffModel) return;

		// @ts-ignore - getChanges exists on Monaco diff model
		const diffChanges: any[] = diffModel.getChanges();
		if (diffChanges.length === 0) return;

		const position = modifiedEditor.getPosition();
		const currentLine = position?.lineNumber ?? Number.MAX_SAFE_INTEGER;

		let targetChange = [...diffChanges]
			.reverse()
			.find((change: any) => change.modifiedStartLineNumber < currentLine);

		if (!targetChange && diffChanges.length > 0) {
			targetChange = diffChanges[diffChanges.length - 1];
		}

		if (targetChange) {
			modifiedEditor.setPosition({
				lineNumber: targetChange.modifiedStartLineNumber,
				column: 1,
			});
			modifiedEditor.revealLineInCenter(targetChange.modifiedStartLineNumber);
		}
	};

	const getChangeCount = (
		editor: monacoEditor.editor.IStandaloneDiffEditor | null,
	): number => {
		if (!editor) return 0;
		const diffModel = editor.getModel();
		if (!diffModel) return 0;
		// @ts-ignore - getChanges exists on Monaco diff model
		return diffModel.getChanges().length;
	};

	return {
		goToNextChange,
		goToPrevChange,
		getChangeCount,
	};
}
