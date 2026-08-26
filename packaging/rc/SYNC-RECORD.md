# RC cross-platform synchronization record

This record tracks source synchronization, platform changes, and platform
validation separately. A platform can be synchronized while its build or test
status remains pending.

Last updated: 2026-08-26 (Asia/Shanghai)

## Status vocabulary

- Source sync: `SYNCED`, `PENDING`, `BLOCKED`, `N/A`
- Validation: `PASS`, `PENDING`, `FAIL`, `NOT_RUN`, `N/A`
- Release readiness: `READY`, `PENDING`, `BLOCKED`, `SUPERSEDED`

## Current common identity

| Field | Value |
| --- | --- |
| Source branch | `rc/0.2.3-kc3/source` |
| Current shared source candidate | `b13e6d4c3726ee8a1fd8113c936f7243393822fe` |
| Current shared source tree | `d0154163a627eb025fb1a6ec54699204fc334baf` |
| Final release-input source | `PENDING` — requires the Phase 4S change/PR |
| Phase 4S change branch | `change/rc-1.0.0-product-policy` (historic name; application version remains `0.2.3`) |
| Product name | `书小安` (pending source integration) |
| Application version | `0.2.3` |
| Windows executable | `书小安.exe` (pending source integration) |
| Controlled A3S | `@a3s-lab/code@6.6.1-knowledge-complete.3` |
| A3S source revision | `07707ad74785f940e6579d692d7f142c13231040` |
| A3S source-tree SHA-256 | `3321cde6cd7d6b7c1439f09d22d7449b501dc8200fdbbbfe09a5334f5d83fc62` |
| Windows A3S input | private prerelease `verified`; remote redownload SHA-256 matched |
| `pnpm-lock.yaml` canonical LF SHA-256 | `3cbf40699c2fced7e2424bb1a888343cd20a48dd55326edaa5c8b30cc9a45dae` |
| A3S dependency selection | single lock + deterministic ignored staging; Windows fresh frozen install and native load `PASS` |
| Mac dependency validation | `PENDING_MAC_NATIVE_VALIDATION` — blocks final source freeze/formal packages |
| Current source Cargo lock SHA-256 | `2195809d302d3f31a30d1832b45b581fc129857b3e5d8c8556652ae44daaf9be` |
| Phase 4S Cargo lock SHA-256 | `5048a42edf9a54d0f1ca578053a5041c91318f06791f41e212a299b458a8c969` (updater removal only) |

The current source candidate already contains the shared runtime and A3S
contracts from PR #2 and PR #3. Phase 4S changes release inputs and therefore
requires a new source commit/tree and clean rebuilds on both platforms.

## Platform snapshot

| Platform | Platform branch | Source sync | Platform changes | Validation | Release readiness |
| --- | --- | --- | --- | --- | --- |
| macOS arm64 | `rc/0.2.3-kc3/macos-arm64` | `PENDING` final Phase 4S source | historical targeted/runtime validation `PASS`; no Mac-only source fork | final-source rebuild `NOT_RUN` | `PENDING` |
| Windows x64 | remote branch not yet created | `PENDING` | private A3S asset `verified`; release profile pending PR | fresh frozen dependency install/native load `PASS`; NSIS/install/start `NOT_RUN` | `PENDING` |

## Synchronization events

### INPUT-20260826-01 — Windows A3S private asset verification

- Private prerelease: `rc-inputs-0.2.3-kc3`
- Asset: `a3s-lab-code-6.6.1-knowledge-complete.3-win32-x64.tgz`
- Asset bytes: `20510255`
- TGZ SHA-256: `18ca8253e1711b2abc4d850250e2210a928916c18b9d73637554e0abe9e68187`
- Native: `index.win32-x64-msvc.node`
- Native SHA-256: `d3f64db2c28a529b75a581ae9b2ebaabbc938b0e4e998071a87bcd004c852b77`
- Verification: independent remote redownload and SHA-256 recomputation `PASS`
- Source synchronization: `PENDING` until the updated input manifest is merged

### WIN-DEPS-20260826-01 — Windows controlled dependency resolution

- Source snapshot: Phase 4S candidate diff applied to parent
  `b13e6d4c3726ee8a1fd8113c936f7243393822fe`
- Host: Windows x64; Node `22.18.0`; pnpm `11.19.0`
- Initial state: no `node_modules`, no selected A3S directory, no restored
  target TGZ, and a new empty pnpm store
- Input provenance: independently redownloaded private-release asset; proof
  manifest SHA-256
  `8145284091ee07282a2bac47a6b8c10f787179ff7e23b993602727c6df205239`
- Command contract: controlled restore, deterministic staging, and
  `pnpm install --frozen-lockfile` followed by native-load verification
- Result: desktop and Sidecar both resolved the selected Windows package;
  `index.win32-x64-msvc.node` loaded successfully; Darwin native count `0`
- Windows TGZ SHA-256:
  `18ca8253e1711b2abc4d850250e2210a928916c18b9d73637554e0abe9e68187`
- Windows native SHA-256:
  `d3f64db2c28a529b75a581ae9b2ebaabbc938b0e4e998071a87bcd004c852b77`
- Lock result: canonical LF SHA-256
  `3cbf40699c2fced7e2424bb1a888343cd20a48dd55326edaa5c8b30cc9a45dae`;
  tracked lock unchanged by the frozen install
- Candidate tracked-state result: unchanged before/after; a clean detached
  post-commit reproduction remains the pre-push evidence gate
- Mac status: `PENDING_MAC_NATIVE_VALIDATION`; Windows does not claim a Mac
  native result

### SRC-20260826-02 — Phase 4S controlled release-input change

- Parent source: `b13e6d4c3726ee8a1fd8113c936f7243393822fe`
- Parent tree: `d0154163a627eb025fb1a6ec54699204fc334baf`
- Change branch: `change/rc-1.0.0-product-policy` (branch name retained;
  distribution version remains `0.2.3`)
- Product identity: `书小安` / `0.2.3`
- Windows contract: `书小安.exe`, NSIS stock `installMode=both`, offline
  WebView2, Simplified Chinese and English, unsigned internal candidate
- Updater: disabled in Tauri config, Rust plugin/commands, and Web UI/runtime
- Bundled Node: fail-closed `22.18.0`
- Package manager dependency: desktop/Sidecar use the stable selected-directory
  locator; target TGZ/public SDK/native identity remains pinned by the combined
  lock, RC inputs, policy, staging, and install-verifier authority
- Source synchronization: `PENDING` — change commit and PR required
- Windows build/install/start: `NOT_RUN`
- Mac final-source rebuild: `PENDING`; required after source integration
- Phase-one Windows `1.0.0` installer: historical installation evidence only

### SRC-20260826-01 — bundled Node PATH source integration

- Source commit: `0fa9cb0282b43a029853ed868b276dc10873faa9`
- Parent: `4594f88239a02bb89a92dce4d4a0bb3b00ee8d2b`
- Changed source: `apps/desktop/src-tauri/src/server.rs`
- Platform impact: `cross-platform-sensitive`
- Source synchronization: remote `source` contains the change
- Mac disposition: validated
- Windows disposition: review and native validation required
- A3S inputs: unchanged
- History handling: direct-push bootstrap exception; do not rewrite

### MAC-20260826-01 — macOS source synchronization

- Target source: `0fa9cb0282b43a029853ed868b276dc10873faa9`
- Remote platform branch: `rc/0.2.3-kc3/macos-arm64`
- Remote platform branch head: `0fa9cb0282b43a029853ed868b276dc10873faa9`
- Source synchronization: `SYNCED`
- Platform-only source commits: none; the platform branch points directly to the
  common source commit
- Source-byte audit: 1,272 application/package/lock files matched the remote
  source byte-for-byte; no mismatched, missing, or additional core files
- Platform-only source changes: none
- Local binary inputs intentionally outside Git: controlled Darwin A3S TGZ and
  runtime assets referenced by manifests and hashes

Mac validation already completed for the product change:

- focused Rust regression: 5/5 passed;
- Rust library suite: 28/28 passed;
- `cargo check --all-targets`, `rustfmt --check`, and scoped diff-check passed;
- signed native App launch, Sidecar health, and clean exit passed;
- deterministic WebSocket with real A3S Bash passed;
- one real `boyue/gpt-5` WebSocket campaign passed with
  `followDefaultModel=false` and bundled Node `v22.18.0` resolved;
- ZIP and DMG integrity, deep codesign verification, and critical-file parity
  passed.

Sanitized evidence identifiers:

- modified `server.rs` SHA-256:
  `ceddf5a57e1addc2a0b751e95eb35b8d3c01d432309bd9471e99849a5457a1b0`;
- internal validation ZIP SHA-256:
  `6b71d5bf53d0b3f9a9c05df381498669f510e6afda7cfca5cdba508276644fff`;
- internal validation DMG SHA-256:
  `afdbd940c010e4dc5ed8170965ae0a1e59afb0212944ce63eae20505f7a083c0`;
- validation summary SHA-256:
  `4f163fbf70588aa4530da7164c7a75e53d583dc4831faed76361c659c2540fb1`.

Evidence locations and publication state:

- local report:
  `outputs/acceptance/mac-node-path-fix-20260826.Wu2pN4/VALIDATION.md`;
- local structured report:
  `outputs/acceptance/mac-node-path-fix-20260826.Wu2pN4/validation-summary.json`;
- asset names: `InternShannon_0.2.3_arm64-node-path-fix.app.zip` and
  `InternShannon_0.2.3_arm64-node-path-fix.dmg`;
- remote evidence publication: `PENDING`; hashes are recorded here, but the
  package and local reports have not been uploaded to Git.

Mac validation toolchain:

- macOS `15.0`, Apple Silicon `arm64`;
- bundled Node `v22.18.0`;
- Tauri `2.11.5`, tauri-build `2.6.3`, tauri-plugin-shell `2.3.5`;
- Tokio `1.53.1`;
- Rust/Cargo `1.94.1`;
- pnpm `11.19.0`.

This validation is accepted as functional evidence. Final macOS RC readiness is
still `PENDING` because the final package must be rebuilt from a clean checkout
of the source identity selected after Windows review.

### WIN-20260826-01 — Windows review handoff

- Target source: `0fa9cb0282b43a029853ed868b276dc10873faa9`
- Source synchronization: `PENDING`
- Windows source changes: none
- Validation: `NOT_RUN`
- Required checks: Rust tests/check, Explorer launch, bundled `node.exe`
  resolution without system Node, spaces/Chinese install path, inherited PATH,
  controlled A3S native build, NSIS install/start, and real WebSocket shell
- If unchanged source passes: record Windows `PASS` without a source commit
- If adaptation is required: branch `adapt/0fa9cb0-windows-x64`, implement a
  portable fix, and return it to `source` by pull request

## Open synchronization work

1. Commit and review the Phase 4S release-input change through a PR to source.
2. Reproduce the Windows fresh-worktree frozen install and native-load gate at
   the clean Phase 4S commit before push.
3. Complete Mac arm64 fresh-worktree frozen install and native-load validation;
   until then the PR may be reviewed but must not become the final source freeze.
4. Merge only after approval and both native dependency gates, then freeze the
   new final source commit/tree.
5. Build and validate Windows from that exact identity.
6. Rebuild macOS from the same final identity.
7. Record platform asset-manifest and installer hashes on evidence branches.
8. Integrate sanitized platform results without changing the frozen source.
