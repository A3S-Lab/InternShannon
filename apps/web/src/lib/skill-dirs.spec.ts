import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  LOCAL_DESKTOP_SKILL_USER_SCOPE,
  composeSkillDirs,
  resolveAgentSkillDirs,
  type SkillDirResolvers,
} from "./skill-dirs.ts";

const agentRuntimeConfigSource = readFileSync(
  fileURLToPath(new URL("./agent-runtime-config.ts", import.meta.url)),
  "utf8",
);

// These tests protect the contract that reviewer #7 explicitly required:
//   1) skillDirs must include all three scopes (agent / user / shared) so
//      that a SKILL.md placed under any of them is actually discovered.
//   2) Duplicate paths must collapse so downstream loaders don't scan the
//      same directory twice.
//   3) A failed user/shared path resolver must not break session creation —
//      upstream code catches the rejection and feeds "" here, which we drop.

test("composeSkillDirs includes agent, user, and shared scopes unchanged", () => {
  const dirs = composeSkillDirs("users/local/agents/foo/skills", "users/local/skills", "users/local/shared/skills");

  assert.deepEqual(dirs, ["users/local/agents/foo/skills", "users/local/skills", "users/local/shared/skills"]);
});

test("composeSkillDirs deduplicates identical scopes", () => {
  // In single-user local mode, getSharedSkillsPath(null) and getUserSkillsPath(null)
  // may legitimately resolve to adjacent or identical roots; the Set must collapse them.
  const dirs = composeSkillDirs(
    "users/local/agents/foo/skills",
    "users/local/skills",
    "users/local/skills", // duplicate of user path
  );

  assert.deepEqual(dirs, ["users/local/agents/foo/skills", "users/local/skills"]);
});

test("composeSkillDirs deduplicates even when only user and shared collide", () => {
  const dirs = composeSkillDirs("users/local/agents/foo/skills", "users/local/skills", "users/local/skills");

  assert.equal(dirs.length, 2);
  assert.ok(dirs.includes("users/local/agents/foo/skills"));
  assert.ok(dirs.includes("users/local/skills"));
});

test("composeSkillDirs drops an empty user path so session creation is not blocked", () => {
  // getUserSkillsPath(null).catch(() => "") feeds "" here when the personal
  // directory cannot be resolved. Session creation must still surface agent
  // and shared scopes.
  const dirs = composeSkillDirs("users/local/agents/foo/skills", "", "users/local/shared/skills");

  assert.deepEqual(dirs, ["users/local/agents/foo/skills", "users/local/shared/skills"]);
});

test("composeSkillDirs drops an empty shared path without dropping agent or user", () => {
  const dirs = composeSkillDirs("users/local/agents/foo/skills", "users/local/skills", "");

  assert.deepEqual(dirs, ["users/local/agents/foo/skills", "users/local/skills"]);
});

test("composeSkillDirs surfaces a non-empty agent scope even if both user and shared failed", () => {
  // Worst-case: only the agent workspace resolves. Session must still start
  // and surface at least the agent's own skills directory.
  const dirs = composeSkillDirs("users/local/agents/foo/skills", "", "");

  assert.deepEqual(dirs, ["users/local/agents/foo/skills"]);
});

test("composeSkillDirs trims whitespace before dedup so padded duplicates collapse", () => {
  // Realistic: a path resolver that returned a value with surrounding newlines.
  const dirs = composeSkillDirs("users/local/agents/foo/skills", "  users/local/skills  ", "\tusers/local/skills\n");

  assert.deepEqual(dirs, ["users/local/agents/foo/skills", "users/local/skills"]);
});

function fakeResolvers(overrides: Partial<SkillDirResolvers> = {}): SkillDirResolvers {
  return {
    async getAgentWorkspacePath(agentId) {
      return `/workspace/users/local/agents/${agentId}`;
    },
    async getUserSkillsPath() {
      return "/workspace/users/local/skills";
    },
    async getSharedSkillsPath() {
      return "/workspace/users/local/shared/skills";
    },
    ...overrides,
  };
}

test("resolveAgentSkillDirs builds the three directories used by buildAgentRuntimeConfig", async () => {
  const dirs = await resolveAgentSkillDirs("default", fakeResolvers());

  assert.deepEqual(dirs, [
    "/workspace/users/local/agents/default/skills",
    "/workspace/users/local/skills",
    "/workspace/users/local/shared/skills",
  ]);
  assert.match(
    agentRuntimeConfigSource,
    /await resolveAgentSkillDirs\(agent\.id, \{[\s\S]*?getAgentWorkspacePath,[\s\S]*?getUserSkillsPath,[\s\S]*?getSharedSkillsPath,/,
  );
});

test("resolveAgentSkillDirs deduplicates resolver results", async () => {
  const dirs = await resolveAgentSkillDirs(
    "default",
    fakeResolvers({
      async getAgentWorkspacePath() {
        return "/workspace/users/local";
      },
    }),
  );

  assert.deepEqual(dirs, ["/workspace/users/local/skills", "/workspace/users/local/shared/skills"]);
});

test("a rejected personal path resolver does not block runtime config resolution", async () => {
  const dirs = await resolveAgentSkillDirs(
    "default",
    fakeResolvers({
      async getUserSkillsPath() {
        throw new Error("personal skills directory is unavailable");
      },
    }),
  );

  assert.deepEqual(dirs, ["/workspace/users/local/agents/default/skills", "/workspace/users/local/shared/skills"]);
});

test("personal and shared resolvers use the same explicit local desktop scope", async () => {
  const seen: Array<[string, string | number | null]> = [];
  await resolveAgentSkillDirs(
    "default",
    fakeResolvers({
      async getUserSkillsPath(userId) {
        seen.push(["user", userId]);
        return "/workspace/users/local/skills";
      },
      async getSharedSkillsPath(userId) {
        seen.push(["shared", userId]);
        return "/workspace/users/local/shared/skills";
      },
    }),
  );

  assert.equal(LOCAL_DESKTOP_SKILL_USER_SCOPE, null);
  assert.deepEqual(seen, [
    ["user", null],
    ["shared", null],
  ]);
});
