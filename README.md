# InternShannon

InternShannon is a local-first desktop workspace with two product capabilities:
agent chat and knowledge-base management. The desktop app owns the user
experience. The sidecar owns local API coordination, configuration, workspace
access, asset metadata, agent sessions, and integration bridges.

The first principle is simple: a desktop assistant should not need a cloud
control plane to be useful. It should start locally, keep state locally, and
make every external dependency explicit.

## What This Repository Is

This repository contains the desktop shell and its local sidecar runtime.

- `apps/desktop` is the Tauri desktop application and packaging toolchain.
- `apps/sidecar` is the NestJS sidecar API that runs with the desktop app.
- `packages/*` are shared libraries used by the sidecar and desktop tooling.

The default target is a single-user desktop installation. There is no IAM
system, no Postgres dependency, and no Kubernetes runtime in the desktop path.
Local compatibility shells may exist where older controller signatures need
stable metadata, but desktop access is local and capability-oriented rather
than account-login-oriented.

## Core Constraints

The codebase is shaped by these constraints:

- Local first: the application must be useful without cluster infrastructure.
- Explicit boundaries: domain code must not depend on transport, storage, or
  framework details.
- Desktop runtime only: adapters are file-backed or desktop-backed unless a
  module explicitly documents another integration.
- Small trusted surface: sidecar APIs should be understandable as local desktop
  APIs, not a general multi-tenant backend.
- Product focus: keep the desktop path centered on agent chat and
  knowledge-base management; supporting OCR and planning libraries stay at
  explicit package boundaries.

## Architecture

The sidecar follows bounded-context layering:

```text
apps/sidecar/src
  modules/
    assets/
      domain/
      application/
      infrastructure/
      presentation/
    config/
    kernel/
    loop/
  runtime/
    desktop/
  shared/
    domain/
    api/
    infrastructure/
    security/
```

Layer rules:

- `domain` contains entities, value objects, ports, and business contracts.
- `application` coordinates use cases and depends on domain ports.
- `infrastructure` implements adapters such as desktop file persistence.
- `presentation` exposes HTTP/WebSocket controllers, DTOs, and interceptors.
- `runtime/desktop` wires the desktop-only module graph.
- `shared/domain` is framework-agnostic; Nest, Swagger, validation, and
  transport DTOs belong under API or presentation paths.

The boundary checker enforces the most important import and placement rules:

```bash
pnpm sidecar:ddd:check
```

## Repository Layout

```text
.
  apps/
    desktop/      Tauri shell, release scripts, local doctor checks
    sidecar/      NestJS desktop sidecar runtime
  packages/
    agent-planning/
    lark/
    ocr/
    ooxml/
  pnpm-workspace.yaml
```

## Requirements

- Node.js and pnpm
- Rust toolchain, only when building or validating the desktop shell
- Platform tools required by Tauri for local desktop builds

The sidecar build path does not require Docker, Postgres, Redis, or Kubernetes.

## Install

```bash
pnpm install
```

## Common Commands

Build the sidecar:

```bash
pnpm sidecar:build
```

Run the DDD boundary check:

```bash
pnpm sidecar:ddd:check
```

Run the desktop doctor:

```bash
pnpm desktop:doctor
```

Stage sidecar resources for the desktop app:

```bash
pnpm desktop:stage-sidecar
```

Run every package test script that exists:

```bash
pnpm test
```

## Sidecar Development

The sidecar entry point is:

```text
apps/sidecar/src/intern-shannon-sidecar.module.ts
```

The desktop runtime sets:

```text
APP_MODE=desktop
KERNEL_WORKSPACE_STORAGE_PROVIDER=local
PIPELINE_RUNNER_DRIVER=none
```

Local state defaults to `~/.internshannon`, unless overridden by:

```text
INTERNSHANNON_DATA_DIR
INTERN_SHANNON_DATA_DIR
```

## Desktop Development

The desktop app lives under `apps/desktop` and packages the sidecar as a local
resource. Human-facing product text uses `InternShannon`; package names,
paths, and code identifiers keep their tooling-specific casing.

Useful commands:

```bash
pnpm --filter @internshannon/desktop doctor:test
pnpm --filter @internshannon/desktop stage:sidecar
pnpm --filter @internshannon/desktop tauri:build
```

## Verification Checklist

Before pushing changes that affect the sidecar or desktop runtime, run the
smallest meaningful subset of these checks:

```bash
pnpm sidecar:ddd:check
pnpm exec tsc -p apps/sidecar/tsconfig.build.json --noEmit
node apps/sidecar/scripts/build-desktop-sidecar.mjs
pnpm --filter @internshannon/desktop doctor:test
```

For changes to desktop packaging metadata, also validate the Tauri manifest:

```bash
cargo metadata --manifest-path apps/desktop/src-tauri/Cargo.toml --no-deps --format-version 1
```

## Naming

The product and human-facing brand is `InternShannon`.

Package names use lowercase npm-compatible scopes:

```text
@internshannon/workspace
@internshannon/desktop
@internshannon/sidecar
```

Rust crate identifiers use lowercase or snake case as required by Rust tooling.
Code identifiers may use `internShannon` when camelCase is the local convention.

## Current Direction

Keep the codebase boring in the places that should be boring:

- Prefer local file-backed desktop adapters over service infrastructure.
- Keep domain contracts free of NestJS, Swagger, validators, and DTO decorators.
- Add runtime-specific wiring under `runtime/desktop`, not inside domain code.
- Treat README, doctor checks, and boundary scripts as part of the product
  surface. They should explain what is true, not what we hope is true.
