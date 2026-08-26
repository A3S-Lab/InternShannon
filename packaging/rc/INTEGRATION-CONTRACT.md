# Cross-platform RC source synchronization contract

This contract keeps the macOS arm64 and Windows x64 release work on one product
source line. The two hosts do not copy working directories to one another and do
not maintain long-lived platform forks. They exchange immutable Git identities,
external asset manifests, and sanitized validation records.

The live platform state is recorded in `SYNC-RECORD.md`.

## Source and release identities

The release identity is a tuple, not just an installer filename:

- exact product source commit and Git tree;
- `pnpm-lock.yaml` and Cargo lock hashes;
- controlled A3S version, source revision, and source-tree SHA-256;
- platform asset-manifest SHA-256;
- platform toolchain versions;
- final installer and critical binary hashes.

Mac and Windows must use the same product source commit/tree and controlled A3S
source identity. Platform-native A3S binaries, TGZ files, Node distributions,
browser runtimes, installers, and their hashes are expected to differ.

Mutable coordination records must not change a frozen product identity. Before
the source is frozen, this contract and the initial record may be maintained on
the source branch. After freeze, new platform results belong on the platform or
integration branch and must point back to the frozen source commit.

## Branch model

```text
main
└─ rc/0.2.3-kc3/source
   ├─ change/<id>-<summary>
   ├─ adapt/<id>-<platform>
   ├─ rc/0.2.3-kc3/macos-arm64
   ├─ rc/0.2.3-kc3/windows-x64
   └─ rc/0.2.3-kc3/integration
```

- `main` mirrors or reconciles with the public upstream baseline.
- `source` is the only product-source truth for this RC.
- `change/*` is a short-lived change branch that either host may create.
- `adapt/*` is a short-lived platform adaptation branch that either host may
  create when the common source fails on that platform.
- `macos-arm64` and `windows-x64` contain platform validation or packaging
  evidence. They must not become independent product-source lines.
- `integration` contains the reviewed union of coordination records and
  platform evidence. It is not a build source.

Shared fixes and build-relevant platform configuration must return to `source`
through a pull request. Platform branches may retain sanitized evidence and
platform-only packaging records without merging those records into the frozen
product source.

## Change classification

Every source change is classified at its highest applicable risk:

| Class | Typical changes | Other-platform disposition |
| --- | --- | --- |
| `macos-only` | notarization, DMG layout, macOS entitlement | Windows records `N/A` |
| `shared` | React, Sidecar business logic, portable Rust | Windows syncs and tests |
| `cross-platform-sensitive` | paths, processes, Tauri, locks, A3S, Node | Windows review required |
| `release-policy` | version, branding, updater, install-data policy | both platforms confirm |
| `binary-input` | TGZ, `.node`, Node runtime, browser runtime | external asset + manifest |

A declaration of `macos-only` is invalid if shared or cross-platform-sensitive
paths are changed.

Recommended commit or PR metadata:

```text
Platform-Impact: shared|cross-platform-sensitive|macos-only|release-policy
Windows-Disposition: review-required|direct-test|not-applicable
MacOS-Validated: <checks>|pending
Windows-Validated: <checks>|pending|not-applicable
A3S-Inputs: unchanged|<version/revision>
Source-Base: <parent source commit>
```

The Git parent remains authoritative. Published history is never rewritten only
to add missing metadata; missing declarations are backfilled in the sync record.

## Source change workflow

Start every change from the latest remote source:

```bash
git fetch rc-private
git switch -c change/<id>-<summary> \
  rc-private/rc/0.2.3-kc3/source
```

Then:

1. classify the change;
2. keep shared logic, platform adaptation, release policy, and evidence in
   reviewable commits;
3. run the tests required by the highest impact class;
4. push only the feature branch;
5. open a pull request to `rc/0.2.3-kc3/source`;
6. freeze a new source identity after the pull request lands.

`source` and `main` should reject direct pushes after this bootstrap contract is
landed. Do not force-push, move a published freeze tag, or resolve lock conflicts
with an unreviewed whole-file `ours`/`theirs` choice.

## Platform synchronization

Synchronization means checking out the exact common source commit. It does not
mean cherry-picking commits that are already on `source`.

For either host:

```text
fetch remote source
review the range since the last synchronized source
check out the exact source commit
verify locks and controlled inputs
run platform-required tests
record sync and validation separately
```

`SYNCED` does not imply `PASS`: a platform may have the correct source while its
native build or validation is still pending or failed.

### Windows review and adaptation

Windows must explicitly review changes involving paths, `Command` or
`child_process`, shells, permissions, symlinks, Tauri, WebView2, NSIS, locks,
Node, A3S, or native modules.

If the exact source passes, Windows records validation without creating a source
commit. If adaptation is required, create `adapt/<id>-windows-x64` from the
failed source commit. A portable fix returns to `source`; after it lands, both
platforms rebuild and revalidate the new source identity.

### macOS review and adaptation

macOS follows the same rule for Windows-originated shared changes and uses
`adapt/<id>-macos-arm64` when a Mac-specific adaptation is required. A platform
branch may record signing, notarization, DMG, launch, and UI evidence, but the
App must be built from the frozen common source identity.

## Synchronization record

`SYNC-RECORD.md` is append-only for completed or superseded events. Each record
must distinguish:

- source synchronization: `SYNCED`, `PENDING`, `BLOCKED`, `N/A`;
- platform validation: `PASS`, `PENDING`, `FAIL`, `NOT_RUN`, `N/A`;
- the source commit being evaluated;
- platform changes or adaptations;
- controlled-input changes;
- evidence locations and hashes;
- remaining work.

After source freeze, update the record on `integration` or a platform evidence
branch. Do not update the frozen source merely to change `PENDING` to `PASS`.

## Binary and evidence policy

Normal Git history may contain source, scripts, lockfiles, manifests, and
sanitized summaries. Do not commit credentials, local configuration, expanded
applications, caches, Provider secrets, raw transcripts, TGZ files, `.node`
files, DMG files, or installers.

### Platform-native package-manager selection

Desktop and Sidecar use the tracked stable dependency locator
`vendor/a3s/selected/package`. A host-native staging script must populate that
ignored directory from the exact target TGZ in `RC-INPUTS.json` before a frozen
install. The lock, RC inputs, controlled policy, staging script, and installed
package verifier form one dependency authority; the directory locator alone is
not an integrity claim.

Formal validation must start without `node_modules`, a selected package, or a
reused pnpm store. Restore, stage, frozen install, installed-package verification,
native load, unchanged lock hash, and clean Git status are all required. The
stage and verifier must reject a target different from the native host. Windows
cannot report Mac native validation; an unexecuted Mac gate is recorded as
`PENDING_MAC_NATIVE_VALIDATION` and blocks the final source freeze.

Binary inputs and outputs use an approved release asset store and are referenced
by immutable names and SHA-256. If this repository is public, its GitHub Release
assets are public too; confidential assets require a separate private store.

## Required controls

- protect `source` and `main` and require pull requests;
- prevent force-push and branch deletion;
- review declared impact against changed paths;
- require platform evidence appropriate to the impact class;
- scan commits for secrets, native binaries, installers, caches, and large files;
- preserve the first failure and never label unrun platform work as passed.

GitHub Actions are currently disabled, and branch protection is not yet enabled,
so the contract, local hooks, and scripts currently provide process controls but
not a remote enforcement boundary. After branch protection is enabled,
pull-request rules become the remote enforcement boundary. Because one owner
operates both hosts, the Mac and Windows validations are separated by evidence
and source identity rather than pretending they are independent human approvals.

## RC completion and upstream promotion

Final status is reported as four independent gates:

- Source Integration PASS;
- macOS Packaging PASS;
- Windows Packaging PASS;
- Full Functional RC PASS.

Public promotion contains reviewed product source and build-policy changes only.
Platform binaries, private asset locations, and internal evidence are excluded.
Promotion uses a personal-fork pull request to `A3S-Lab/InternShannon`.

The existing direct source commit `0fa9cb0282b43a029853ed868b276dc10873faa9`
is a recorded bootstrap exception. It remains in history and is not amended,
reverted, or duplicated solely to retrofit this process.
