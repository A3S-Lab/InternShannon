# Desktop Scripts

These scripts support the current InternShannon Tauri desktop flow.

- `desktop-doctor.mjs`: read-only preflight for local desktop development.
- `stage-sidecar-resources.mjs`: copy `apps/sidecar/dist` into
  `src-tauri/resources/sidecar`, or stage a standalone runtime with
  `--standalone`.
- `stage-node-runtime.mjs`: download, verify, cache, and stage an official
  Node.js runtime into `src-tauri/resources/node`.
- `build-standalone-tauri.mjs`: build a standalone verification app or release
  bundle, validate the bundled sidecar, smoke-test it when possible, then reset
  staged source resources.
- `verify-sidecar-resources.mjs`: validate sidecar JS resources in a Tauri
  Resources directory.
- `smoke-standalone-sidecar.mjs`: launch the bundled sidecar from an isolated
  temporary copy and wait for `/api/v1/health`.

Generated resources under `src-tauri/resources/sidecar` and
`src-tauri/resources/node` are staging outputs for Tauri development and bundle
verification.
