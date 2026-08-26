# macOS arm64 打包依赖与工具链

本清单对应 `InternShannon_0.2.3_arm64-kc3.dmg` 和同名 app.zip。版本来自最终 App、`pnpm-lock.yaml`、`Cargo.lock` 及实际构建命令，不是仅按 `package.json` 范围推测。

## 交付身份

- 书小安 / InternShannon：`0.2.3`
- 目标：`darwin-arm64`，Mach-O arm64
- App 源码快照 SHA-256：`4d6f9430c92aa492f3b301a410553046ab6ee980c285a047362d234d83728ea3`
- Git HEAD：`a4e89b7470a25f43ea62de30b64a44aa131598a2`
- `pnpm-lock.yaml` SHA-256：`c5a700d89248573c49d2a6c7c8e9a0ed27258f9e33f3cabf348a71236e6d3659`
- `Cargo.lock` SHA-256：`2195809d302d3f31a30d1832b45b581fc129857b3e5d8c8556652ae44daaf9be`

## 实际随包分发的运行时

- Node.js：`v22.18.0`
  - 二进制 SHA-256：`9187ad22c98cea5b635a79db52fa32ab3f6aa9d41e3abf5da71437cfef1ca9de`
- `@a3s-lab/code`：`6.6.1-knowledge-complete.3`
  - TGZ SHA-256：`1119c3649a6b3308acc9b692f14aedcc77ecc4db76d7c3f28aadd5d25eca29eb`
  - A3S source revision：`07707ad74785f940e6579d692d7f142c13231040`
  - sourceTreeSha256：`3321cde6cd7d6b7c1439f09d22d7449b501dc8200fdbbbfe09a5334f5d83fc62`
  - `index.darwin-arm64.node` SHA-256：`2e797e935b18c11c586fbbba6a59f6dc6b3aa77094a311b32b95dd4b53292fec`
  - 内嵌 native `a3s-acl`：`0.3.0`
- Lightpanda：`0.3.1@85d84c296ed592a0a924c8dee3426dbf7881b560`
  - darwin-arm64 SHA-256：`9ee31612f3d46ff513056d021b15daba4f07368c050debe25e8aa8527587b074`

注意：Sidecar 直接依赖的 JS 包 `@a3s-lab/acl@0.2.1` 与 `@a3s-lab/code` 原生 binding 报告的 `a3s-acl@0.3.0` 是两个不同层级，不能互相替代。

## 实际构建机工具链

- macOS：`15.0`，build `24A5320a`，Apple Silicon arm64
- Xcode：`16.2`，build `16C5032a`
- macOS SDK：`15.2`
- Apple clang：`16.0.0 (clang-1600.0.26.6)`
- Rust：`rustc 1.94.1 (e408947bf 2026-03-25)`
- Cargo：`1.94.1 (29ea6fb6a 2026-03-24)`
- 构建编排 Node.js：`v20.9.0`
- pnpm：`11.19.0`
- TypeScript：`5.9.3`
- Biome：`2.3.14`
- 安装方式：`pnpm install --frozen-lockfile --offline`
- 打包时固定内置 Node：`INTERNSHANNON_NODE_VERSION=v22.18.0`

构建编排使用的 Node `20.9.0` 与最终随包分发的 Node `22.18.0` 是不同角色；用户运行 App 时使用后者。

## Tauri / Rust 锁定版本

- `@tauri-apps/cli`：`2.11.3`
- `tauri`：`2.11.5`
- `tauri-build`：`2.6.3`
- `tauri-runtime`：`2.11.3`
- `tauri-runtime-wry`：`2.11.4`
- `tauri-utils`：`2.9.3`
- `wry`：`0.55.1`
- `tao`：`0.35.3`
- `tauri-plugin-shell`：`2.3.5`
- `tauri-plugin-http`：`2.5.9`
- `tauri-plugin-dialog`：`2.7.2`
- `tauri-plugin-fs`：`2.5.1`
- `tauri-plugin-global-shortcut`：`2.3.2`
- `tauri-plugin-clipboard-manager`：`2.3.2`
- `tauri-plugin-updater`：`2.10.1`
- `tokio`：`1.53.1`
- `serde`：`1.0.229`
- `serde_json`：`1.0.151`
- `time`：`0.3.51`
- `chrono`：`0.4.45`
- `notify`：`6.1.1`
- `notify-debouncer-mini`：`0.4.1`
- App 直接使用的 `reqwest`：`0.11.27`；依赖树同时包含 `0.12.28`、`0.13.4`

## Web 前端关键锁定版本

- React / React DOM：`18.3.1`
- Rsbuild：`1.3.11`
- `@tauri-apps/api`：`2.11.1`
- `@tauri-apps/plugin-dialog`：`2.7.1`
- `@tauri-apps/plugin-http`：`2.5.9`
- `@tauri-apps/plugin-shell`：`2.3.5`
- `socket.io-client`：`4.8.3`
- `react-router-dom`：`7.18.0`
- `react-virtuoso`：`4.18.10`
- `streamdown`：`2.5.0`
- Monaco Editor：`0.55.1`
- Tiptap core：`3.27.1`
- Univer core / slides：`0.24.0`
- Three.js：`0.184.0`
- Playwright（构建/测试依赖）：`1.61.1`
- Tailwind CSS：`3.4.19`

Web 工程共有 115 个直接运行依赖、17 个直接开发依赖；完整精确版本见 `packaging/rc/macos/web-direct-dependencies.raw.json`。

## Sidecar 关键锁定版本

- Sidecar：`1.0.0`
- NestJS common/core/platform-express/platform-socket.io/websockets：`11.1.19`
- `@nestjs/axios`：`4.0.1`
- `@nestjs/config`：`4.0.4`
- `@nestjs/cqrs`：`11.0.3`
- `@nestjs/swagger`：`11.4.4`
- `@nestjs/terminus`：`11.1.1`
- Express：`5.2.1`
- Socket.IO：`4.8.3`
- RxJS：`7.8.2`
- Axios：`1.13.6`
- `class-transformer`：`0.5.1`
- `class-validator`：`0.14.4`
- `dotenv`：`17.4.1`
- Helmet：`8.2.0`
- `pdf-parse`：`2.4.5`
- SheetJS `xlsx`：`0.18.5`
- `js-yaml`：`4.3.0`
- JSZip：`3.10.1`
- UUID：`9.0.1`
- Workspace 包 `@a3s-lab/agent-planning`、`@a3s-lab/lark`、`@a3s-lab/ocr`：均为 `0.0.1`

Sidecar 共有 40 个直接运行依赖、18 个直接开发依赖；完整精确版本见 `packaging/rc/macos/sidecar-direct-dependencies.raw.json`。

## 完整可复现输入

- `pnpm-lock.yaml`
- `apps/desktop/src-tauri/Cargo.lock`
- `apps/desktop/package.json`
- `apps/web/package.json`
- `apps/sidecar/package.json`
- `apps/desktop/src-tauri/Cargo.toml`
- `packaging/rc/macos/browser-binary.json`
- `packaging/rc/macos/desktop-direct-dependencies.raw.json`（1 个运行依赖、6 个开发依赖）
- `packaging/rc/macos/web-direct-dependencies.raw.json`
- `packaging/rc/macos/sidecar-direct-dependencies.raw.json`

传递依赖以复制出的两份 lockfile 为最终权威，不以本文的关键依赖摘要替代。
