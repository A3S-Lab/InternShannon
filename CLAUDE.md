# InternShannon Agent Guide

Last verified: 2026-06-30

This document is for Claude Code, Codex, and other code-aware agents working in
this repository. It captures current repo facts, operating constraints, and
easy-to-hit edges. Treat it as working guidance, not as a product white paper or
roadmap.

## Product-first rule

Product usability comes before test convenience. Tests are guardrails for the
intended user experience; they are not the product goal.

When behavior feels wrong in real use, first define the normal user workflow and
the expectation that would make the product feel natural. Then design the code
and tests to protect that workflow. Do not reshape the product merely to satisfy
a narrow test, make a test easy to write, or make an implementation easy to
verify.

## Project overview

InternShannon is a pnpm workspace for the desktop InternShannon product:

```text
apps/
├── sidecar/   # NestJS 11 desktop API sidecar
├── web/       # React 18 + Rsbuild frontend used by the desktop shell
└── desktop/   # Tauri v2 shell and desktop packaging

packages/
├── agent-planning/
├── lark/
├── ocr/
└── ooxml/
```

Root package: `@internshannon/workspace`.

Package manager: `pnpm`.

The repo root is not a Rust workspace. Do not create `Cargo.toml` or `src/` at
the root. Rust and Tauri changes must stay under `apps/desktop/src-tauri/`.

The historical upstream monorepo used `apps/api`. This repository uses
`apps/sidecar` for the NestJS runtime. Do not create or edit `apps/api` based on
old notes.

## Current architecture notes

### Sidecar

`apps/sidecar` is the NestJS desktop sidecar. It contains the current backend
modules for local desktop operation:

- `modules/assets`
- `modules/config`
- `modules/kernel`
- `modules/loop`
- shared API, security, observability, desktop, and infrastructure helpers under
  `shared/`

Business modules generally follow a DDD / Clean Architecture layout:

```text
modules/<name>/
├── domain/          # entities, value objects, repository/service interfaces
├── application/     # commands, queries, handlers, application services
├── infrastructure/  # persistence, desktop/local/external implementations
├── presentation/    # controllers, gateways, request/response DTOs
└── <name>.module.ts
```

Rules:

1. Domain code stays framework-free TypeScript: no NestJS, HTTP, DB, or desktop
   imports.
2. Business modules consume infrastructure through interface tokens, not through
   concrete implementations.
3. DTOs belong under `presentation/dto/request` or
   `presentation/dto/response`; application services should not carry HTTP DTOs.
4. Controllers stay thin and delegate to `CommandBus`, `QueryBus`, or
   application services.
5. Before editing a controller or repository, check whether the corresponding
   application service, handler, and desktop provider are actually implemented.
6. When adding a provider, bind the token explicitly and verify that runtime
   modules do not override each other accidentally.

### Web

`apps/web` is the React/Rsbuild frontend. It contains desktop routes,
agent-session UI, kernel session connection code, and reusable runtime UI
pieces.

Frontend changes should follow existing React, Tailwind, and local component
patterns. The product design language lives in `DESIGN.md`; desktop-specific
frontend conventions live in `apps/desktop/CLAUDE.md`.

### Desktop

`apps/desktop` owns the Tauri shell, sidecar staging, bundle checks, and native
desktop packaging. Do not bypass its scripts when verifying sidecar resources in
a bundle.

## Dev commands

Common root commands:

```bash
pnpm install
pnpm build
pnpm test
pnpm --filter @internshannon/sidecar build
pnpm --filter @internshannon/sidecar exec jest --runInBand
pnpm --filter @internshannon/web run desktop:build
pnpm --filter @internshannon/desktop run build
```

Common `just` commands:

```bash
just install
just sidecar-build
just sidecar-test --runInBand
just ddd
just typecheck
just doctor
just check
just dev
just desktop
just build
just bundle
just check-sidecar
just check-standalone
just smoke-standalone
```

`just dev`, `just desktop`, `just desktop-local`, and `just desktop-dev` are
aliases around the desktop development flow. They build and stage the sidecar,
then run the Tauri dev shell. If ports are occupied, use the printed runtime
URLs instead of assuming fixed ports.

## Code style

- Search before implementing. Use `rg` to find existing providers, DTOs,
  handlers, tests, and call sites.
- Read affected files and adjacent implementations before editing. Do not infer
  feature completeness from directory names.
- Keep changes small and focused. Avoid speculative abstractions and unrelated
  cleanup.
- Prefer a single source of truth. Avoid useless re-exports, duplicate wrappers,
  orphaned exports, and catch-all helper files in new code.
- Never proactively clean up existing orphans such as unused props, hooks, files,
  or exports. This repo is frequently edited by multiple agents, IDEs, and user
  scripts. What looks unused may be an extension point another process is
  rewiring.
- Production code should not lean on `any`, swallowed errors, or bare `throw`s.
  Error messages should include enough context to diagnose the failing area.
- Code identifiers, public APIs, and comments prefer English. Agent-facing
  Chinese notes for this repo may remain when they clarify collaboration.
- Follow the style of surrounding files; the repo uses Biome and TypeScript.

## Git safety

- The working tree may be dirty. Never revert, reset, restore, clean, or delete
  files unless the user explicitly asks for that operation.
- Never roll back the user's pending changes.
- Before `git pull --rebase`: commit, or `git stash push -m "<message>"`.
- `git stash pop` can corrupt work after a failed merge or rebase. Inspect diffs
  before and after.
- If stash pop conflicts or fails, prefer `git stash branch recovery` to preserve
  state.
- A symbol with no callers, an externally modified file, or an untracked
  directory does not mean the user abandoned it. Report suspicious state instead
  of cleaning it up.

## API conventions

API responses should reuse the existing shared API / desktop interceptor,
filter, and OpenAPI helpers. Do not hand-roll a different response envelope in a
single controller.

Success response wrapper:

```json
{
  "code": 200,
  "message": "Success",
  "data": {},
  "requestId": "uuid",
  "timestamp": "2026-04-17T00:00:00.000Z"
}
```

Error response wrapper:

```json
{
  "code": 404,
  "statusCode": "NOT_FOUND",
  "message": "Resource not found",
  "details": {},
  "requestId": "uuid",
  "timestamp": "2026-04-17T00:00:00.000Z"
}
```

Principles:

- `code` is the HTTP status code.
- `statusCode` is the business error code or framework error identifier.
- New endpoints must carry the existing shared OpenAPI decorators and documented
  error responses.
- Keep response shape consistent across desktop routes unless a shared filter
  already differentiates them.

## Time and timestamp rules

Backend timestamps must be unambiguous. Time-zone translation belongs at the
frontend display layer unless a product requirement explicitly says otherwise.

Rules:

1. Persist timestamps as ISO 8601 with timezone, or as epoch milliseconds.
2. API response timestamps must include a timezone suffix such as `Z` or
   `+08:00`.
3. Do not write `new Date().toLocaleString()`, `.toLocaleDateString()`, or
   `.toString()` into DB writes, API responses, audit logs, SSE payloads, Lark /
   Feishu messages, or webhooks.
4. `Date.now()`, `Date.parse()`, and `.getTime()` are UTC epoch operations and
   are safe to use where epoch ms is intended.
5. Frontend display should use a single formatting utility instead of scattering
   ad hoc date formatting.

Useful grep:

```bash
rg -nE "toLocaleString|toLocaleDateString|format\([^)]*['\"](YYYY-MM-DD HH:mm:ss|YYYY/MM/DD)" apps/sidecar/src apps/web/src --type ts
```

## Verification guidance

Pick the smallest sufficient verification for the risk and blast radius.

- Sidecar structural / provider changes: `pnpm --filter @internshannon/sidecar build`
- Sidecar tests: `pnpm --filter @internshannon/sidecar exec jest --runInBand`
- DDD boundaries: `pnpm --filter @internshannon/sidecar run ddd:check` or `just ddd`
- Type checking: `just typecheck`
- Web desktop build: `pnpm --filter @internshannon/web run desktop:build`
- Desktop packaging / sidecar staging: use `apps/desktop` scripts or `just build`
- Tauri or bundle resource changes: also run the relevant `tauri:*`,
  `check-sidecar`, `check-standalone`, or standalone smoke command

If a command requires external services, credentials, the Tauri toolchain, OS
permissions, browsers, package registries, or network access, call out the
environmental prerequisite that prevented full verification.

## Tests and documentation

- Tests exist to protect the user workflow, not to define it in isolation.
- Behavior changes ship with new or updated tests when the risk justifies them.
- When removing behavior, remove or update the related tests; do not leave dead
  `skip` / `ignore` markers.
- Prefer integration tests for CLI flows, networking, cross-module workflows,
  provider switches, sidecar staging, and runtime/session behavior.
- Tests must not leak temp files, listening ports, or background processes.
- After a feature lands, update related READMEs, design docs, or module notes
  when the mental model changes.
- Examples and commands should be runnable as written; when that is not possible,
  state the environment dependency.

## Pre-commit self-check

- Searched the existing implementation.
- Read affected files and adjacent providers / modules / controllers.
- Defined the intended user workflow before fitting the tests.
- Kept scope contained; no incidental refactors.
- Preserved user changes and concurrent-process work.
- DDD layering, DTO placement, provider-token binding, and API response shape
  match current module style.
- Desktop / sidecar / web differences were considered.
- Relevant build / tests ran, or skipped reasons and environmental prerequisites
  are documented.
