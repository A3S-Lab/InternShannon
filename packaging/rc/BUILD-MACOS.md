# macOS arm64 RC build

The current Mac preview was built from the legacy source snapshot recorded in
`RC-INPUTS.json`. Its package evidence remains useful, but its RC status is
blocked by the recorded compact-conversation smoke failure. It is not evidence
for a future Windows-integrated source commit.

## Restore the controlled SDK

Use native macOS arm64 with Node 22.18.0 and pnpm 11.19.0. Start from a
clean checkout with no `node_modules`, restored A3S asset, selected dependency,
or reused pnpm store, then run:

```bash
node packaging/rc/scripts/restore-controlled-a3s.mjs --target darwin-arm64
node packaging/rc/scripts/stage-controlled-a3s-dependency.mjs --target darwin-arm64
pnpm install --frozen-lockfile --store-dir /new/empty/pnpm-store
node packaging/rc/scripts/verify-controlled-a3s-install.mjs \
  --target darwin-arm64 --require-native-load
git diff --exit-code
test -z "$(git status --porcelain)"
```

The restore command downloads only the pinned private release asset. The stage
command validates its SHA-256, common SDK bytes, source identity, unique Darwin
native module, and then writes the verified package to the ignored stable
dependency path consumed by both workspace manifests. All formal commands reject
a target different from the current host. A Windows run cannot satisfy this Mac
gate.

Mac native execution is currently `PENDING_MAC_NATIVE_VALIDATION`. It must pass
before this change can become the final release-input source freeze or feed a
formal NSIS/DMG build.

## Normal validation

```bash
pnpm --filter @internshannon/desktop test:release-contracts
pnpm --filter @internshannon/sidecar build
pnpm --filter @internshannon/web run desktop:build
pnpm --filter @internshannon/desktop run build
```

The final Mac build must also run the controlled SDK, search-browser, resources,
standalone/WebSocket/lifecycle, signing, installation, launch/exit, non-knowledge
chat, and 01-session-script checks defined by the release evidence. Keep the
current preview's known failure visible until a later source commit passes it.

## Dependency authority

The dependency authority is the combined hash set of `pnpm-lock.yaml`,
`RC-INPUTS.json`, `controlled-a3s-package.json`, and the tracked stage/install
verifiers. The shared lock records the stable selected directory; the policy and
RC inputs pin the platform TGZ, native binary, source identity, and public SDK
bytes. The captured Mac build environment and selected direct dependency versions
are under `packaging/rc/macos/`; Windows must add its actual native toolchain
versions rather than copying Mac-only values.
