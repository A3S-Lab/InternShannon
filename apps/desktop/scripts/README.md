# Desktop Scripts

These scripts support the current InternShannon Tauri desktop flow.

- `desktop-doctor.mjs`: read-only preflight for local desktop development.
- `stage-sidecar-resources.mjs`: copy `apps/sidecar/dist` into
  `src-tauri/resources/sidecar`, or stage a standalone runtime with
  `--standalone`.
- `stage-node-runtime.mjs`: download, verify, cache, and stage an official
  Node.js runtime into `src-tauri/resources/node`.
- `build-standalone-tauri.mjs`: build a standalone verification app or release
  bundle, validate the bundled sidecar, then run health, knowledge/restart/HITL,
  automatic and manual compaction, no-automatic-model-switch, and same-model
  429 retry probes when the target can run on the host. Finally it resets
  staged source resources.
- `verify-sidecar-resources.mjs`: validate sidecar JS resources in a Tauri
  Resources directory.
- `verify-sdk-runtime.mjs`: inspect the packaged SDK manifest, native platform
  binding, compiled ACL dependency marker, controlled package identity, and
  embedded native binary hash. Release builds use `--require-controlled`.
- `verify-search-browser-resource.mjs`: fail a release when the bundled
  Lightpanda binary, pinned manifest, SHA-256, architecture-specific asset, or
  runtime-reported version is missing or inconsistent.
- `smoke-standalone-sidecar.mjs`: launch the bundled sidecar from an isolated
  temporary copy and wait for `/api/v1/health`.
- `smoke-unicode-provider-websocket.mjs`: launch the packaged sidecar, configure
  a Unicode provider, and complete a deterministic agent response over the real
  Socket.IO WebSocket transport. Pass `--verify-compact` for one automatic
  compaction, or `--verify-compact-suite` for two rolling compactions across a
  Sidecar restart plus concurrent-session isolation. Summary bodies and the
  paired fake key remain in memory and never enter the probe report. Use
  `--compaction-delay-ms <ms>` with `--verify-compact` to exercise the layered
  SDK/runner timeout boundary against a deliberately slow summary response.
  `--verify-knowledge` exercises search/read/structured query and same-session
  continuation; `--verify-knowledge-restart` stops and restarts the real
  Sidecar, accepts the old signed cursor only with the same data directory, and
  rejects it with a different data directory. `--verify-hitl-lifecycle` covers
  confirmation, tool execution, and the immediate post-authorization follow-up.
  `--verify-model-switch` is an explicit user-requested model change; the
  runtime must never switch models automatically.
- `smoke-zhipu-429-websocket.mjs`: validate the packaged controlled A3S runtime
  through a real Socket.IO session and the local Zhipu compatibility proxy. A
  429 must end promptly as `model_busy`, then a same-session/same-model retry
  must succeed without an `active operation` collision.
- `smoke-no-auto-model-switch.mjs`: reject implicit default-model execution and
  prove every upstream request stays on the explicitly selected provider/model.
- `smoke-fire-evacuation-acceptance.mjs`: fail-closed acceptance gate for the
  checked-in `01-会话问题脚本.md`. It fingerprints the installed App and
  controlled SDK, verifies the fixed content fingerprint of the exact 14-source
  fixture plus both the raw-script and normalized 28-turn/9-session
  fingerprints, then (only with `--yes-run-real-provider`) starts the packaged
  Sidecar against a temporary data directory and runs every prompt through the
  real Socket.IO WebSocket transport on fixed `boyue/gpt-5`. Automatic model
  switching is disabled. The isolated profile is generated from only the
  `boyue/gpt-5` provider/model fields; unrelated providers and application
  secrets are never copied. Web search engines, external MCP servers, browser
  binaries, and inherited credential environment variables are disabled before
  the Sidecar starts. The paired
  `fire-evacuation-acceptance-contract.spec.mjs` checks the parser, fixture
  isolation, failure-closed evidence rules, and D-1 consistency without a
  provider call.

Run the non-billable, read-only preflight first:

```bash
node apps/desktop/scripts/smoke-fire-evacuation-acceptance.mjs \
  --preflight-only \
  --report /tmp/fire-acceptance-preflight.json
```

After explicitly approving the 28 real provider calls, write the evidence
report outside the live App data and Resources directories:

```bash
node apps/desktop/scripts/smoke-fire-evacuation-acceptance.mjs \
  --yes-run-real-provider \
  --report /absolute/path/to/fire-acceptance-real.json
```

The real gate imports only the 14 approved Markdown/CSV fixtures into an
ephemeral personal knowledge base. It writes a minimal provider configuration
into that temporary profile, tracks citation-finalization logs within each
individual turn, removes the profile even when startup fails, and never records
credentials in its JSON/Markdown report.
Passing the automatic gate does not replace the source-card click/locator and
answer-quality scoring in `02-人工验收与参考答案.md`.

Standalone builds always resolve `config/controlled-a3s-package.json`. The
pinned package is staged from `vendor/a3s`; missing bytes, a different SHA-256,
mismatched source metadata, or an unsupported host target fail the build instead
of falling back to registry `@a3s-lab/code@6.6.0`.
`INTERNSHANNON_LOCAL_A3S_PACKAGE` can only override the artifact location and
must still match the pinned identity.

Generated resources under `src-tauri/resources/sidecar` and
`src-tauri/resources/node` are staging outputs for Tauri development and bundle
verification. Standalone deploys use the official npm registry for ordinary
dependencies; the controlled A3S package is always replaced after deploy. Set
`INTERNSHANNON_NPM_REGISTRY` to use an approved internal registry.
