Core skill sync utilities live here.

- `sync-core-skills.mjs sync`: copy backend-owned embedded core skills into `src-tauri/resources/skills`
- `sync-core-skills.mjs check`: fail if embedded and distribution copies drift
- `desktop-doctor.mjs`: read-only preflight for desktop-local CLI readiness, sidecar build output, and port state
- `stage-sidecar-resources.mjs`: copy `apps/sidecar/dist` into `src-tauri/resources/sidecar`,
  or stage a standalone runtime with `--standalone`
- `stage-node-runtime.mjs`: download, checksum, cache, and stage an official
  Node.js runtime into `src-tauri/resources/node`
- `build-standalone-tauri.mjs`: build a standalone verification `.app` or release
  bundle, validate the bundled sidecar, then reset source resources back to
  dist-only and clear staged Node runtime files
- `verify-sidecar-resources.mjs`: validate bundled sidecar JS resources inside a `.app`
- `smoke-standalone-sidecar.mjs`: launch the bundled sidecar from an isolated
  temporary copy and wait for `/api/v1/health`

`sync-core-skills.mjs`
- Syncs backend-owned core skill markdown into desktop resources.

`verify-box-resources.mjs`
- Validates a bundled `a3s-box` resource directory by checking `manifest.json`,
  required files, and declared runtime libraries.
- Default target is `src-tauri/resources/box`.
- Can also validate an extracted bundle directory via `--dir <path>`.

`stage-sidecar-resources.mjs`
- Stages the built NestJS desktop sidecar from `apps/sidecar/dist` into
  `src-tauri/resources/sidecar`.
- Tauri maps this directory into the app Resources root so production startup
  can resolve `Resources/main.js`.
- `--standalone` uses `pnpm --filter @a3s-lab/api deploy --prod --legacy` and
  `--config.node-linker=hoisted`, then stages `node_modules`, `env`, `config`,
  and `builtin-assets` for release validation. This may need registry access if
  the pnpm store is cold.
- Standalone staging removes pnpm install metadata such as `.modules.yaml`; those
  files are not needed at runtime and can make pnpm 11 treat generated resources
  as a workspace install target.

`build-standalone-tauri.mjs`
- Runs Tauri with `INTERNSHANNON_SIDECAR_STAGE_MODE=standalone`, validates the
  resulting `.app` with `--require-standalone`, smoke-tests the bundled sidecar
  process with the bundled Node.js runtime when present, and then restores
  `src-tauri/resources/sidecar` to dist-only and clears `src-tauri/resources/node`
  so normal workspace commands stay lightweight.
- Pass `--release` to use the default release Tauri config; `pnpm tauri:bundle`
  uses this path so installer builds do not accidentally ship dist-only sidecar
  resources.

`stage-node-runtime.mjs`
- Stages official Node.js release archives from `https://nodejs.org/dist` into
  `src-tauri/resources/node`. Archives are cached under
  `apps/desktop/.cache/node-runtime` and verified against `SHASUMS256.txt`.
- Defaults to the current Node.js 22.x release. Use
  `INTERNSHANNON_NODE_VERSION`, `INTERNSHANNON_NODE_PLATFORM`, or
  `INTERNSHANNON_NODE_ARCH` to pin or cross-stage a specific runtime.

`verify-sidecar-resources.mjs`
- Checks that a built `.app` Resources directory contains the sidecar entrypoint
  and required compiled API files.
- Use `--require-standalone` for release validation that must include resolvable
  external Node.js dependencies, a bundled Node.js runtime, and portable sidecar
  resources.

`smoke-standalone-sidecar.mjs`
- Copies the target Resources/sidecar directory into `/tmp`, starts `main.js`
  with desktop sidecar env (`APP_MODE=desktop`, loopback host, local workspace
  storage), waits for `/api/v1/health`, then terminates the process.
- The temporary copy prevents the smoke from passing by accidentally resolving
  the repo root `node_modules` while the app is still inside the working tree.

`desktop-doctor.mjs`
- Run through `just desktop-doctor` from the repo root or `pnpm run doctor` in
  `apps/desktop`.
- Checks `just`, `pnpm`, the Nest CLI, Rsbuild CLI, Tauri CLI, the built sidecar
  entrypoint, the fixed desktop API port `29653`, and the requested desktop web
  port (`PUBLIC_DESKTOP_DEV_PORT`, `PORT`, or `5000`).
- It never installs dependencies, starts services, or kills processes. A busy
  healthy API port is accepted; a busy unhealthy API port fails; a busy web port
  is only a warning because `desktop-local` and `desktop-dev` can fall back.

`build-macos-dmg.sh`
- Builds `internShannon.app`, patches bundled `a3s box` dylib linkage, refreshes the
  updater archive/signature, verifies bundled `box` resources, and then packages
  the app into a distributable macOS `.dmg`.
- Keeps the updater archive `internShannon.app.tar.gz` in the build output so the app
  remains updater-capable.
- Loads updater signing materials from `~/.tauri/safeclaw-updater.key*` by default
  so local DMG builds stay updater-ready without manual env exports.
