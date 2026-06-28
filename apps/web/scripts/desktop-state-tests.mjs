import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

const desktopStateSpecs = [
  "../desktop/scripts/desktop-doctor-state.spec.mjs",
  "scripts/desktop-local-banner.spec.mjs",
  "scripts/desktop-local-ready.spec.mjs",
  "scripts/desktop-smoke.spec.mjs",
  "src/components/agent-page/agent-config-panel-accessibility.spec.ts",
  "src/components/agent-page/external-skill-import-state.spec.ts",
  "src/components/agent-page/agent-session-create-state.spec.ts",
  "src/components/agent-page/agent-session-sidebar-state.spec.ts",
  "src/components/agent-page/floating-internShannon-assistant-state.spec.ts",
  "src/components/agent-page/floating-internShannon-assistant-drag-contract.spec.ts",
  "src/components/agent-page/floating-internShannon-assistant-drag-state.spec.ts",
  "src/components/agent-page/floating-internShannon-assistant-position.spec.ts",
  "src/components/agent-page/skill-market-browser-state.spec.ts",
  "src/components/agent-page/chat/agent-clear-session-state.spec.ts",
  "src/components/agent-page/chat/agent-chat-input-focus-state.spec.ts",
  "src/components/agent-page/chat/agent-chat-scroll-state.spec.ts",
  "src/components/agent-page/chat/agent-chat-search-state.spec.ts",
  "src/components/agent-page/chat/agent-chat-session-state.spec.ts",
  "src/components/agent-page/chat/agent-slash-command-state.spec.ts",
  "src/components/agent-page/chat/agent-message-inbox-state.spec.ts",
  "src/components/agent-page/chat/agent-message-retry-state.spec.ts",
  "src/components/agent-page/chat/agent-input-draft-state.spec.ts",
  "src/components/agent-page/chat/agent-input-send-state.spec.ts",
  "src/components/agent-page/chat/agent-input-upload-state.spec.ts",
  "src/components/agent-page/chat/message-item-image-state.spec.ts",
  "src/components/agent-page/chat/session-relaunch-state.spec.ts",
  "src/components/agent-page/chat/session-model-selection.spec.ts",
  "src/components/agent-page/chat/session-status-bar-accessibility.spec.ts",
  "src/components/agent-page/chat/session-status-bar-state.spec.ts",
  "src/components/agent-page/chat/streaming-display-utils.spec.ts",
  "src/components/agent-page/chat/tool-confirmation-state.spec.ts",
  "src/components/agent-page/chat/tool-call-display-utils.spec.ts",
  "src/components/agent-page/chat/types.spec.ts",
  "src/components/chat/components/ai-provider-settings-state.spec.ts",
  "src/components/custom/tool-confirmation-dialog-state.spec.ts",
  "src/components/tiptap-editor/submit-state.spec.ts",
  "src/components/ui/dialog-title-detection.spec.ts",
  "src/components/ui/resizable-handle-state.spec.ts",
  "src/components/ui/scroll-area-style-cleanup.spec.ts",
  "src/components/ui/sheet-overlay-contract.spec.ts",
  "src/components/workspace/file-tree-editor/layout-state.spec.ts",
  "src/desktop/boot-overlay-accessibility.spec.ts",
  "src/components/workspace/file-tree-editor/image-viewer-state.spec.ts",
  "src/components/workspace/file-tree-editor/keyboard-shortcuts.spec.ts",
  "src/components/workspace/file-tree-editor/native-reveal-state.spec.ts",
  "src/desktop/components/app-update-bootstrap-state.spec.ts",
  "src/desktop/components/backend-startup-guard-accessibility.spec.ts",
  "src/desktop/components/backend-startup-diagnostics.spec.ts",
  "src/desktop/layouts/chat/activity-route-state.spec.ts",
  "src/desktop/layouts/chat/chat-layout-route-rendering.spec.ts",
  "src/desktop/layouts/chat/components/startup-config-dialog-responsive.spec.ts",
  "src/desktop/layouts/chat/components/user-profile-trigger-state.spec.ts",
  "src/desktop/layouts/sidebar-layout-state.spec.ts",
  "src/desktop/pages/agent/agent-page-session-state.spec.ts",
  "src/desktop/pages/agent/skills-page-state.spec.ts",
  "src/desktop/pages/settings/components/ai-section-state.spec.ts",
  "src/desktop/pages/settings/components/mcp-section-state.spec.ts",
  "src/desktop/pages/settings/components/search-section-state.spec.ts",
  "src/desktop/pages/settings/settings-layout-state.spec.ts",
  "src/desktop/pages/settings/settings-section-state.spec.ts",
  "src/desktop/pages/settings/components/workspace-section-state.spec.ts",
  "src/kernel/session/assistant-message-normalization.spec.ts",
  "src/kernel/session/context-compact-activity.spec.ts",
  "src/kernel/session/history-message-normalization.spec.ts",
  "src/kernel/session/memory-activity.spec.ts",
  "src/kernel/session/message-history-replay.spec.ts",
  "src/kernel/session/result-message-normalization.spec.ts",
  "src/kernel/session/session-status-normalization.spec.ts",
  "src/kernel/session/stream-event-normalization.spec.ts",
  "src/kernel/session/stream-stalled-activity.spec.ts",
  "src/kernel/session/socket-message-normalization.spec.ts",
  "src/kernel/session/tool-circuit-activity.spec.ts",
  "src/kernel/session/tool-error-activity.spec.ts",
  "src/kernel/session/planning-state.spec.ts",
  "src/lib/agentation-flag.spec.ts",
  "src/lib/ability/permission-gate.spec.ts",
  "src/lib/browser-storage.spec.ts",
  "src/lib/chart.spec.ts",
  "src/lib/desktop-gateway-url.spec.ts",
  "src/lib/key-combo.spec.ts",
  "src/lib/runtime-environment.spec.ts",
  "src/lib/session-workspace-path.spec.ts",
  "src/lib/internShannon-memory-timeline-contract.spec.ts",
  "src/lib/internShannon-memory-timeline-conversation.spec.ts",
  "src/lib/internShannon-memory-timeline-item.spec.ts",
  "src/lib/internShannon-memory-timeline-record.spec.ts",
  "src/lib/internShannon-memory-timeline.spec.ts",
  "src/lib/internShannon-memory-sync.spec.ts",
  "src/lib/internShannon-memory-server.spec.ts",
  "src/lib/markdown-source-formatting.spec.ts",
  "src/lib/mcp-server-config.spec.ts",
  "src/models/agent-registry-persistence.spec.ts",
  "src/models/agent-session-persistence.spec.ts",
  "src/models/settings-runtime-model-config-state.spec.ts",
  "src/models/settings-backend-mappers.spec.ts",
  "src/models/settings-model-config-normalization.spec.ts",
  "src/models/workspace-root-migration.spec.ts",
];

const missingSpecs = desktopStateSpecs.filter((spec) => !existsSync(join(packageRoot, spec)));

if (missingSpecs.length > 0) {
  console.error("[desktop-state-test] missing spec files:");
  for (const spec of missingSpecs) {
    console.error(`  - ${spec}`);
  }
  process.exit(1);
}

console.log(`[desktop-state-test] running ${desktopStateSpecs.length} desktop/agent state specs`);

const child = spawn(process.execPath, ["--test", ...desktopStateSpecs], {
  cwd: packageRoot,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[desktop-state-test] interrupted by ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});

child.on("error", (error) => {
  console.error(`[desktop-state-test] failed to start Node test runner: ${formatError(error)}`);
  process.exitCode = 1;
});

function formatError(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
