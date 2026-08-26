# 书小安 cross-platform RC

This directory is the handoff boundary for macOS arm64 and Windows x64 builds.
Both platforms use one canonical source identity. Platform-native binaries stay
outside normal Git and are verified by manifest and SHA-256 before use.

Current status:

- common product source candidate is `b13e6d4c3726ee8a1fd8113c936f7243393822fe`;
  the final release-input identity remains pending this change/PR.
- macOS must rebuild from the final source selected after this release-input
  change; controlled A3S input and validation state are in `SYNC-RECORD.md`.
- existing macOS package: internal preview only; known compact-session smoke
  history and the current clean-source rebuild requirement remain recorded.
- Windows handoff inputs and the native A3S TGZ are verified. The exact TGZ and
  checksum sidecar are published to the private `rc-inputs-0.2.3-kc3`
  prerelease and were independently downloaded and rehashed; source
  integration, NSIS, install smoke, and real-chain checks remain pending.
- desktop and Sidecar resolve A3S through one deterministic, ignored selected
  directory. The tracked selector and verifier pin the target TGZ, common SDK,
  and native bytes; the shared pnpm lock no longer names a Darwin or Windows TGZ.
- Windows clean-worktree frozen-install validation is part of this change gate.
  Mac native frozen-install validation remains `PENDING_MAC_NATIVE_VALIDATION`
  and blocks the final source freeze and formal platform packages.
- the phase-one Windows 1.0.0 installer is installation-behavior evidence only;
  it is not the final dual-platform RC built from one frozen source identity.
- public upstream promotion: deferred until both platform results are integrated.

Start with:

- `INTEGRATION-CONTRACT.md`
- `SYNC-RECORD.md`
- `BUILD-MACOS.md`
- `WINDOWS-HANDOFF.md`
- `RC-INPUTS.json`
- `macos/PACKAGING-DEPENDENCIES.md`

Do not commit credentials, local configuration, native TGZ files, installers,
expanded applications, caches, or raw Provider transcripts. A public GitHub
Release is not a private asset store.
