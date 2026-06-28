import * as assert from "node:assert/strict";
import { test } from "node:test";
import { getSkillsPageSectionFromSearch, resolveSkillsPageStatus } from "./skills-page-state.ts";

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

test("parses supported skills page sections from the route search", () => {
  assert.equal(getSkillsPageSectionFromSearch("?section=config"), "config");
  assert.equal(getSkillsPageSectionFromSearch("?section=personal"), "personal");
  assert.equal(getSkillsPageSectionFromSearch("?section=shared"), "shared");
  assert.equal(getSkillsPageSectionFromSearch("?section=defaults"), "config");
  assert.equal(getSkillsPageSectionFromSearch("?section=missing"), "config");
  assert.equal(getSkillsPageSectionFromSearch(""), "config");
});
