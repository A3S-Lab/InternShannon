import * as assert from "node:assert/strict";
import { test } from "node:test";
import { resolveFileTreePanelLayout } from "./layout-state.ts";

test("keeps the default file tree layout for roomy workbench widths", () => {
  const layout = resolveFileTreePanelLayout({
    variant: "vscode",
    containerWidth: 900,
    fullWidthSidebar: false,
    sidebarDefaultSize: 25,
    sidebarMinSize: 15,
    sidebarMaxSize: 50,
  });

  assert.equal(layout.mode, "normal");
  assert.equal(layout.sidebarDefaultSize, 25);
  assert.equal(layout.sidebarMinSize, 15);
  assert.equal(layout.sidebarMaxSize, 50);
  assert.equal(layout.editorDefaultSize, 75);
  assert.equal(layout.editorMinSize, 40);
});

test("widens the VS Code explorer for compact desktop windows", () => {
  const layout = resolveFileTreePanelLayout({
    variant: "vscode",
    containerWidth: 390,
    fullWidthSidebar: false,
    sidebarDefaultSize: 25,
    sidebarMinSize: 15,
    sidebarMaxSize: 50,
  });

  assert.equal(layout.mode, "compact");
  assert.equal(layout.sidebarDefaultSize, 58);
  assert.equal(layout.sidebarMinSize, 50);
  assert.equal(layout.sidebarMaxSize, 68);
  assert.equal(layout.editorDefaultSize, 42);
  assert.equal(layout.editorMinSize, 24);
});

test("does not change the default variant on compact widths", () => {
  const layout = resolveFileTreePanelLayout({
    variant: "default",
    containerWidth: 390,
    fullWidthSidebar: false,
    sidebarDefaultSize: 22,
    sidebarMinSize: 14,
    sidebarMaxSize: 45,
  });

  assert.equal(layout.mode, "normal");
  assert.equal(layout.sidebarDefaultSize, 22);
});

test("uses a full-width sidebar for board-like views", () => {
  const layout = resolveFileTreePanelLayout({
    variant: "vscode",
    containerWidth: 390,
    fullWidthSidebar: true,
    sidebarDefaultSize: 25,
    sidebarMinSize: 15,
    sidebarMaxSize: 50,
  });

  assert.equal(layout.mode, "full-width");
  assert.equal(layout.sidebarDefaultSize, 100);
  assert.equal(layout.sidebarMinSize, 100);
  assert.equal(layout.sidebarMaxSize, 100);
  assert.equal(layout.editorDefaultSize, 0);
});
