# Windows x64 native-build handoff

The sealed bootstrap asset is stored in the private prerelease:

- asset: `windows-handoff-kc3-20260826-013107.zip`
- SHA-256: `51ecd9a3c97297bbc7caad0120970276c117f8ca87dfd16729f7ca45190d9d92`
- A3S source revision: `07707ad74785f940e6579d692d7f142c13231040`
- A3S source tree: `3321cde6cd7d6b7c1439f09d22d7449b501dc8200fdbbbfe09a5334f5d83fc62`

Download it from `rc-inputs-0.2.3-kc3` with authenticated GitHub CLI and verify
the outer SHA before extraction. The archive contains the A3S Git bundle, path
dependencies, fixtures, PowerShell build scripts, and their inner manifests.

The archive's `app-source.zip` reproduces the historical Mac build snapshot; it
is bootstrap evidence, not the final Git identity. Every Windows build must use
the exact common product source commit selected on `rc/0.2.3-kc3/source`. Use
the handoff to build and verify the native Windows A3S package, then return its
policy and build-contract changes to `source` through a `change/*` branch. Do
not publish a result whose application commit differs from the Mac build.

The win32-x64 A3S package and its `.sha256` sidecar are published in the private
`rc-inputs-0.2.3-kc3` prerelease. An independent remote download verified the
20,510,255-byte TGZ SHA-256 as
`18ca8253e1711b2abc4d850250e2210a928916c18b9d73637554e0abe9e68187` and
the bundled `index.win32-x64-msvc.node` SHA-256 as
`d3f64db2c28a529b75a581ae9b2ebaabbc938b0e4e998071a87bcd004c852b77`.
Its status is `verified`; the restore script may download it from the private
release or accept an explicit same-hash local mirror. Registry and Darwin
fallback remain forbidden.

If Windows needs a shared-source or build-contract modification, create a
`change/*` branch from the latest `source` and return it there for review. Use an
`adapt/*-windows-x64` branch only after the unchanged source fails a direct
Windows test. Platform asset manifests, toolchain evidence, validation status,
and sanitized result records may be committed on the Windows branch; the TGZ
and NSIS installer remain private release assets.

Required native environment:

- x86_64 Windows 10/11 and PowerShell 7.4+
- Node.js 22.18.0 and pnpm 11.19.0
- Rust 1.94.1 for `x86_64-pc-windows-msvc`
- Visual Studio 2022 Build Tools with C++ and a Windows SDK
- WebView2 Runtime and an installed Chrome or Edge browser

Registry fallback to `@a3s-lab/code@6.6.0`, reuse of the Darwin native module,
verifier bypasses, placeholder hashes, and source-identity drift are all hard
failures.

For a fresh Windows x64 dependency installation, use Node 22.18.0 and pnpm
11.19.0 from a clean worktree with no existing `node_modules`, selected A3S, or
pnpm store:

```powershell
node packaging/rc/scripts/restore-controlled-a3s.mjs --target win32-x64
node packaging/rc/scripts/stage-controlled-a3s-dependency.mjs --target win32-x64
pnpm install --frozen-lockfile --store-dir <new-empty-store>
node packaging/rc/scripts/verify-controlled-a3s-install.mjs --target win32-x64 --require-native-load
git diff --exit-code
if (git status --porcelain) { throw 'dependency install dirtied the worktree' }
```

The single-command gate is `pnpm rc:a3s:install:frozen -- --target win32-x64
--store-dir <new-empty-store> --require-clean --require-fresh`. It performs the
remote restore, controlled staging, frozen install, native load, lock hash check,
and Git-clean comparison in that order.
