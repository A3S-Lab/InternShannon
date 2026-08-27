# Controlled local A3S package

This directory contains the platform-native A3S packages used for Book
XiaoAn's controlled desktop builds. Standalone builds must use the exact
artifact pinned by `apps/desktop/config/controlled-a3s-package.json`; missing or
different bytes are a hard build error and must never fall back to a registry
`@a3s-lab/code` package.

Native TGZ files are intentionally excluded from normal Git history. Restore
the verified package from the private RC release and stage the host selection
before installing dependencies:

```bash
node packaging/rc/scripts/restore-controlled-a3s.mjs --target darwin-arm64
node packaging/rc/scripts/stage-controlled-a3s-dependency.mjs --target darwin-arm64
pnpm install --frozen-lockfile
```

The restore command verifies the configured SHA-256 before writing into this
directory. The stage command revalidates the package and writes only the native
host package to ignored `selected/package`, which is the stable local-directory
locator used by desktop, Sidecar, and the shared lock. Neither command downloads
a registry fallback or accepts a foreign host target.

`darwin-arm64/` contains the verified Mac package. `win32-x64/` is populated on
an x86_64 Windows host by the RC handoff scripts. Both packages must be version
`6.6.1-knowledge-complete.3`, have `sourceDirty=false`, and share exactly:

- sourceRevision `07707ad74785f940e6579d692d7f142c13231040`
- sourceTreeSha256 `3321cde6cd7d6b7c1439f09d22d7449b501dc8200fdbbbfe09a5334f5d83fc62`
- all public JavaScript and declaration-file bytes

Only the platform-native `.node` filename/bytes and the derived package and
binary hashes may differ. Run `pnpm --filter @internshannon/desktop
check:a3s-matrix` after the Windows package and policy entry are generated.
