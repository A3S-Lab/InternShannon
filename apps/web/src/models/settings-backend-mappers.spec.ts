import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  backendAppearanceToFrontend,
  backendEditorToFrontend,
  backendNetworkToFrontend,
  backendSearchToFrontend,
  backendStorageToFrontend,
} from "./settings-backend-mappers.ts";
import type { SearchConfig } from "./settings.model.ts";

const fallbackSearch: SearchConfig = {
  enabledEngines: ["ddg", "brave", "bing"],
  browserBackend: "lightpanda",
  chromePath: "/Applications/Chrome.app",
  lightpandaPath: "/usr/local/bin/lightpanda",
  proxy: "http://proxy.local:8080",
  proxyPool: ["http://proxy-a.local:8080"],
  language: "zh-CN",
  safesearch: "moderate",
  timeout: 30,
  limit: 10,
};

test("normalizes malformed backend search settings without throwing", () => {
  assert.deepEqual(
    backendSearchToFrontend(
      {
        enabledEngines: { primary: "ddg" },
        language: 42,
        safesearch: "unsafe",
        timeout: "slow",
        limit: null,
      } as never,
      fallbackSearch,
    ),
    fallbackSearch,
  );

  assert.deepEqual(
    backendSearchToFrontend(
      {
        enabledEngines: ["ddg", "bad", "bing", "ddg"],
        language: " en-US ",
        safesearch: "strict",
        timeout: "15",
        limit: 5,
      } as never,
      fallbackSearch,
    ),
    {
      ...fallbackSearch,
      enabledEngines: ["ddg", "bing"],
      language: "en-US",
      safesearch: "strict",
      timeout: 15,
      limit: 5,
    },
  );
});

test("normalizes malformed backend editor settings into renderable UI values", () => {
  const editor = backendEditorToFrontend({
    tabSize: "4",
    wordWrap: "yes",
    lineNumbers: "sometimes",
    indentGuides: "true",
    fontSize: "18",
    fontFamily: 42,
    cursorStyle: "triangle",
    syntaxHighlighting: "false",
    fontLigatures: "true",
    insertSpaces: "no",
    detectIndentation: null,
    wordWrapColumn: "120",
    minimap: "0",
    renderWhitespace: "bad",
    cursorBlinking: "solid",
    formatOnPaste: "1",
    bracketPairColorization: "0",
    stickyScroll: undefined,
    contextmenu: "false",
    codeLens: "true",
    showFoldingControls: "always",
    glyphMargin: "yes",
    colorDecorators: "no",
    renderLineHighlight: "gutter",
    matchBrackets: "near",
    keybindings: {
      "editor.save": " cmd+s ",
      "editor.bad": 42,
      "editor.disabled": "",
    },
  } as never);

  assert.equal(editor.tabSize, 4);
  assert.equal(editor.wordWrap, "on");
  assert.equal(editor.lineNumbers, "on");
  assert.equal(editor.indentGuides, true);
  assert.equal(editor.fontSize, 18);
  assert.match(editor.fontFamily, /Maple Mono/);
  assert.equal(editor.cursorStyle, "line");
  assert.equal(editor.syntaxHighlighting, false);
  assert.equal(editor.fontLigatures, true);
  assert.equal(editor.insertSpaces, false);
  assert.equal(editor.detectIndentation, true);
  assert.equal(editor.wordWrapColumn, 120);
  assert.equal(editor.minimap, false);
  assert.equal(editor.renderWhitespace, "selection");
  assert.equal(editor.cursorBlinking, "solid");
  assert.equal(editor.formatOnPaste, true);
  assert.equal(editor.bracketPairColorization, false);
  assert.equal(editor.stickyScroll, false);
  assert.equal(editor.contextmenu, false);
  assert.equal(editor.codeLens, true);
  assert.equal(editor.showFoldingControls, "always");
  assert.equal(editor.glyphMargin, true);
  assert.equal(editor.colorDecorators, false);
  assert.equal(editor.renderLineHighlight, "gutter");
  assert.equal(editor.matchBrackets, "near");
  assert.deepEqual(editor.keybindings, {
    "editor.save": "cmd+s",
    "editor.disabled": "",
  });
});

test("normalizes malformed appearance, network, and storage settings", () => {
  assert.deepEqual(
    backendAppearanceToFrontend({
      theme: "neon",
      sideBarPosition: "center",
      statusBar: "false",
      activityBar: "true",
      zoomLevel: "1.25",
    } as never),
    {
      theme: "system",
      sideBarPosition: "left",
      statusBar: false,
      activityBar: true,
      zoomLevel: 1.25,
    },
  );

  assert.deepEqual(
    backendNetworkToFrontend({
      upstreamProxyUrl: 42,
      connectionTimeout: "45000",
    } as never),
    {
      proxyUrl: "",
      proxyAuth: "",
      timeout: 45000,
      maxRetries: 3,
    },
  );

  assert.deepEqual(backendStorageToFrontend({ localStoragePath: 123 } as never), {
    storageBackend: "file",
    sessionsDir: "",
    skillDirs: [],
    agentDirs: [],
  });
});
