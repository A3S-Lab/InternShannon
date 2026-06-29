# InternShannon Desktop

This package contains the Tauri shell for the InternShannon desktop app.

## Development

From the workspace root:

```bash
just dev
```

The `dev` recipe builds the NestJS sidecar, stages it into Tauri resources,
starts the web dev server through Tauri's `beforeDevCommand`, and launches the
desktop shell. The native shell starts or reuses the local sidecar on
`127.0.0.1:29653`.

For browser-only development, run the sidecar and web app separately:

```bash
pnpm --filter @internshannon/sidecar start:dev
pnpm --filter @internshannon/web workspace:dev
```

Then open `http://127.0.0.1:5000`.

## Active Scripts

- `pnpm run doctor`: run the desktop local preflight.
- `pnpm run stage:sidecar`: copy `apps/sidecar/dist` into
  `src-tauri/resources/sidecar`.
- `pnpm run stage:sidecar:standalone`: stage a standalone sidecar runtime for
  bundle validation.
- `pnpm run stage:node-runtime`: stage a Node.js runtime into
  `src-tauri/resources/node`.
- `pnpm run tauri:dev`: start Tauri development mode.
- `pnpm run tauri:bundle`: build a release bundle with standalone sidecar
  resources.
- `pnpm run check:sidecar-resources`: validate bundled sidecar resources in a
  built macOS app bundle.
- `pnpm run check:standalone-sidecar`: validate that bundled sidecar resources
  are standalone.
- `pnpm run smoke:standalone-sidecar`: smoke-test the bundled sidecar from an
  isolated temporary copy.
