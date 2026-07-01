# InternShannon project commands.
#
# Package-specific implementation stays in package.json scripts. This file keeps
# the small set of human-facing shortcuts and generic package script dispatchers.

set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

root := justfile_directory()
desktop_pkg := "@internshannon/desktop"
sidecar_pkg := "@internshannon/sidecar"
web_pkg := "@internshannon/web"

# Show available commands
default:
    @just --justfile "{{root}}/justfile" --list

# Install workspace dependencies
install:
    pnpm --dir "{{root}}" install

# Run a root package.json script
run script *args:
    pnpm --dir "{{root}}" run {{script}} {{args}}

# Run a desktop package script, e.g. `just app tauri:bundle -- --target ...`
app script="doctor" *args:
    pnpm --dir "{{root}}" --filter {{desktop_pkg}} run {{script}} {{args}}

# Run a sidecar package script, e.g. `just sidecar test -- --runInBand`
sidecar script="build" *args:
    pnpm --dir "{{root}}" --filter {{sidecar_pkg}} run {{script}} {{args}}

# Build the local verification desktop app
build:
    pnpm --dir "{{root}}" --filter {{desktop_pkg}} run build

# Run workspace tests
test:
    pnpm --dir "{{root}}" run test

# Run the fast desktop/sidecar verification set
check: ddd typecheck doctor-test
    @echo "checks ok"

# Install the pinned local browser for sidecar web_search
install-browser:
    bash "{{root}}/apps/sidecar/scripts/install-browser.sh"

# Build the NestJS sidecar
sidecar-build:
    pnpm --dir "{{root}}" --filter {{sidecar_pkg}} run build

# Check sidecar DDD boundaries
ddd:
    pnpm --dir "{{root}}" --filter {{sidecar_pkg}} run ddd:check

# Type-check the sidecar build graph
typecheck:
    pnpm --dir "{{root}}" exec tsc -p apps/sidecar/tsconfig.build.json --noEmit

# Run sidecar Jest tests
sidecar-test *args:
    pnpm --dir "{{root}}" --filter {{sidecar_pkg}} exec jest {{args}}

# Run the desktop local preflight
doctor:
    pnpm --dir "{{root}}" --filter {{desktop_pkg}} run doctor

# Run desktop script unit tests
doctor-test:
    pnpm --dir "{{root}}" --filter {{desktop_pkg}} run doctor:test

# Build and stage the sidecar, then start the Tauri desktop dev shell.
# The native shell spawns the sidecar on startup.
dev: sidecar-build stage-sidecar
    pnpm --dir "{{root}}" --filter {{desktop_pkg}} run tauri:dev

# Backward-compatible desktop aliases from the old monorepo justfile
desktop: dev

desktop-local: dev

desktop-dev: dev

desktop-doctor: doctor

desktop-bundle *args:
    @just --justfile "{{root}}/justfile" bundle {{args}}

desktop-smoke: smoke-standalone

desktop-web-smoke:
    pnpm --dir "{{root}}" --filter {{web_pkg}} run desktop:smoke

# Build release installers with standalone sidecar resources
bundle *args:
    pnpm --dir "{{root}}" --filter {{desktop_pkg}} run tauri:bundle -- {{args}}

# Stage sidecar resources for the desktop app
stage-sidecar:
    pnpm --dir "{{root}}" --filter {{desktop_pkg}} run stage:sidecar

# Validate bundled sidecar resources
check-sidecar:
    pnpm --dir "{{root}}" --filter {{desktop_pkg}} run check:sidecar-resources

# Validate standalone bundled sidecar resources
check-standalone:
    pnpm --dir "{{root}}" --filter {{desktop_pkg}} run check:standalone-sidecar

# Smoke-test the standalone bundled sidecar
smoke-standalone:
    pnpm --dir "{{root}}" --filter {{desktop_pkg}} run smoke:standalone-sidecar
