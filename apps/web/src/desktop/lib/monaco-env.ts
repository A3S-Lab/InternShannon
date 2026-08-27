/**
 * Monaco Editor environment configuration.
 * Must be imported BEFORE any Monaco component is rendered.
 * Configures Monaco to use local monaco-editor package instead of CDN.
 */
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import "monaco-editor/min/vs/editor/editor.main.css";
import {
  conf as markdownConfiguration,
  language as markdownLanguage,
} from "monaco-editor/esm/vs/basic-languages/markdown/markdown.js";

// The packaged WKWebView does not reliably pull Monaco's dynamically loaded
// Markdown contribution or its structural CSS. Register the tokenizer and
// configuration eagerly so production and dev render the same selection,
// cursor, and syntax-token layers.
monaco.languages.setLanguageConfiguration("markdown", markdownConfiguration);
monaco.languages.setMonarchTokensProvider("markdown", markdownLanguage);

// Tell @monaco-editor/react to use the local monaco instead of CDN
loader.config({ monaco });
