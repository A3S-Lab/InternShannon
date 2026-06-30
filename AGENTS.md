# Codex Guide

Distilled from the root `CLAUDE.md` for Codex and other coding agents. When this
file and `CLAUDE.md` conflict, the latest repo facts in `CLAUDE.md` win.

## Core rule

Product usability comes before test convenience. Tests protect the intended user
experience; they are not the goal. Define the normal user workflow first, then
write code and tests that preserve it.

## Repo facts

InternShannon is a pnpm workspace:

- `apps/sidecar/`: NestJS 11 desktop API sidecar.
- `apps/web/`: React 18 + Rsbuild frontend used by the desktop shell.
- `apps/desktop/`: Tauri v2 shell and desktop packaging.
- `packages/`: `agent-planning`, `lark`, `ocr`, `ooxml`.

Root package is `@internshannon/workspace`.

The repo root is not a Rust workspace. Do not create root `Cargo.toml` / `src/`.
Rust and Tauri work stays under `apps/desktop/src-tauri/`.

The old upstream used `apps/api`; this repo uses `apps/sidecar`. Do not create
`apps/api` from stale notes.

## Working style

- Search before implementing, preferably with `rg`.
- Read affected files and adjacent implementations before editing.
- Keep changes small and focused; avoid speculative abstractions.
- Never roll back the user's pending changes.
- Never proactively clean up apparent orphans; concurrent agents and scripts may
  be mid-edit.
- Frontend changes follow existing React/Tailwind/local component patterns and
  `DESIGN.md`.
- Desktop-specific conventions live in `apps/desktop/CLAUDE.md`.
- Code identifiers, public APIs, and comments prefer English.

## DDD / NestJS rules

Business modules generally use:

```text
modules/<name>/
├── domain/
├── application/
├── infrastructure/
├── presentation/
└── <name>.module.ts
```

Key rules:

- `domain/` stays framework-free TypeScript.
- Interfaces and DI tokens live in `domain`; concrete providers live in
  `infrastructure`.
- DTOs live in `presentation/dto/request` or `presentation/dto/response`.
- Controllers stay thin and delegate to commands, queries, or application
  services.
- Bind providers explicitly and check desktop/runtime module wiring.

## Git safety

- The working tree may be dirty.
- Without explicit user instruction, never run destructive reset / restore /
  checkout / clean / revert operations.
- Do not delete untracked files unless the user asked.
- On unexpected external changes, work with them or report them; do not overwrite
  them.

## Common commands

```bash
pnpm install
pnpm build
pnpm test
pnpm --filter @internshannon/sidecar build
pnpm --filter @internshannon/sidecar exec jest --runInBand
pnpm --filter @internshannon/web run desktop:build
pnpm --filter @internshannon/desktop run build
```

```bash
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

## Verification policy

- Sidecar changes: run the sidecar build and the smallest relevant Jest set.
- Web changes: run the relevant web build/test.
- Desktop/Tauri/resource changes: run the relevant desktop script plus bundle or
  standalone sidecar checks when packaging is touched.
- If full verification needs credentials, network, package registries, browsers,
  OS permissions, external services, or the Tauri toolchain, say exactly what was
  not covered.

## Self-check

Before committing or reporting done:

- Existing implementations were searched and read.
- User workflow was considered before test shape.
- Scope stayed focused.
- User/concurrent changes were preserved.
- Relevant tests/builds ran, or skipped reasons were documented.
