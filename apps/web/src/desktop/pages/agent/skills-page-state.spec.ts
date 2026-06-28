import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveSkillsPageStatus } from "./skills-page-state.ts";

const skillsWorkspaceSource = readFileSync(
  fileURLToPath(new URL("../../../components/agent-page/agent-skills-workspace.tsx", import.meta.url)),
  "utf8",
);

function assertOrderedSourceSnippets(snippets: string[]) {
  let cursor = 0;
  for (const snippet of snippets) {
    const next = skillsWorkspaceSource.indexOf(snippet, cursor);
    assert.notEqual(next, -1, `Expected snippet after offset ${cursor}: ${snippet}`);
    cursor = next + snippet.length;
  }
}

test("keeps the skills editor unmounted while workspace paths are loading", () => {
  const status = resolveSkillsPageStatus({
    loading: true,
    error: null,
    skillsPath: null,
    sharedSkillsPath: null,
  });

  assert.equal(status.kind, "loading");
});

test("surfaces workspace preparation errors before rendering the editor", () => {
  const status = resolveSkillsPageStatus({
    loading: false,
    error: "workspace unavailable",
    skillsPath: null,
    sharedSkillsPath: null,
  });

  assert.equal(status.kind, "error");
  assert.equal(status.description, "workspace unavailable");
});

test("shows retry feedback while workspace preparation is being retried", () => {
  const status = resolveSkillsPageStatus({
    loading: false,
    retrying: true,
    error: "previous failure",
    skillsPath: null,
    sharedSkillsPath: null,
  });

  assert.equal(status.kind, "retrying");
  assert.match(status.title, /重新准备/);
});

test("requires both personal and shared skills paths before rendering the editor", () => {
  assert.equal(
    resolveSkillsPageStatus({
      loading: false,
      error: null,
      skillsPath: "/tmp/user-skills",
      sharedSkillsPath: null,
    }).kind,
    "not-ready",
  );

  assert.equal(
    resolveSkillsPageStatus({
      loading: false,
      error: null,
      skillsPath: "/tmp/user-skills",
      sharedSkillsPath: "/tmp/shared-skills",
    }).kind,
    "ready",
  );
});

test("lets a completed workspace win over a stale retry flag", () => {
  const status = resolveSkillsPageStatus({
    loading: false,
    retrying: true,
    error: null,
    skillsPath: "/tmp/user-skills",
    sharedSkillsPath: "/tmp/shared-skills",
  });

  assert.equal(status.kind, "ready");
});

test("loads personal and shared skill workspace paths in parallel after agent metadata", () => {
  assertOrderedSourceSnippets([
    "await agentRegistryModel.loadServerAgents();",
    "const [skillsPath, sharedSkillsPath] = await Promise.all([",
    "getUserSkillsPath(currentUserId),",
    "getSharedSkillsPath(currentUserId),",
    "]);",
    "await Promise.all([workspaceApi.mkdir(skillsPath), workspaceApi.mkdir(sharedSkillsPath)]);",
  ]);
});
