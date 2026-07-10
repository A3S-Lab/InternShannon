# 书小安部署前检查清单

本清单适用于本地开发和本地预览。目标是避免旧版 sidecar / web preview
残留，同时保证端口被系统服务或其他应用占用时不会误杀无关进程。

## 1. 必检端口

| 端口 | 服务 | 检查命令 |
|---|---|---|
| `29653` | sidecar API | `lsof -nP -iTCP:29653 -sTCP:LISTEN` |
| `5000` | web preview | `lsof -nP -iTCP:5000 -sTCP:LISTEN` |
| `29654` | 老版本 sidecar 备用端口 | `lsof -nP -iTCP:29654 -sTCP:LISTEN` |

端口有监听者不代表可以直接终止。macOS Control Center / AirPlay Receiver
经常占用 5000，必须先识别进程身份。

## 2. 安全检查与清理

仓库中的 `scripts/predeploy-check.sh` 是进程身份校验的唯一实现。脚本会读取
PID 的 executable、完整命令行和 cwd，并按服务角色校验：

- sidecar 必须是 `apps/sidecar` 下运行的 `node dist/main`、`node src/main`
  或 `nest start`；
- preview 必须是 `apps/web` 下运行的 `rsbuild-node` 或 `rsbuild preview`；
- 打包应用子进程必须位于 `InternShannon.app` bundle 内；
- 任何无法识别的监听者都会输出进程详情并立即中止，不发送信号。

只检查，不终止：

```bash
bash scripts/predeploy-check.sh check
```

安全清理 29653 和 5000：

```bash
bash scripts/predeploy-check.sh stop
```

脚本先校验所有监听 PID，全部通过后才发送 `SIGTERM`。两秒后如仍有残留，
会重新执行同一套身份校验，通过后才发送 `SIGKILL`。因此即使 5000 同时由
Control Center 和 rsbuild 监听，也不会先杀掉 rsbuild 再报错。

也可以只操作指定端口：

```bash
bash scripts/predeploy-check.sh check 29653
bash scripts/predeploy-check.sh stop 29653
```

如从其他 checkout 调用脚本，可显式指定允许的仓库根目录：

```bash
WORKSPACE_ROOT="/absolute/path/to/InternShannon" \
  bash scripts/predeploy-check.sh stop
```

不要复制或另写按端口 `kill` 的脚本；一键清理必须复用上述身份校验。

## 3. 关闭桌面应用

如果服务由 `/Applications/InternShannon.app` 启动，先优雅退出应用，避免
launchd 或父进程重新拉起 sidecar：

```bash
osascript -e 'tell application "InternShannon" to quit'
sleep 2
bash scripts/predeploy-check.sh check
```

## 4. 5000 被系统服务占用

如果脚本输出 `ControlCenter`、`ControlCe`、AirPlay 或其他无法识别的进程，
不要使用 `kill` 或 `kill -9`。改用空闲 web 端口，并同步设置监听端口和公开 URL：

```bash
PUBLIC_DESKTOP_DEV_PORT=5001 \
PUBLIC_DESKTOP_URL=http://127.0.0.1:5001 \
npx pnpm@9 --filter @internshannon/web run preview
```

sidecar 仍使用 29653 时，可在另一个终端启动：

```bash
npx pnpm@9 --filter @internshannon/sidecar run start
```

完整的显式 smoke 命令：

```bash
PUBLIC_DESKTOP_URL=http://127.0.0.1:5001 \
PUBLIC_DESKTOP_GATEWAY_URL=http://127.0.0.1:29653 \
npx pnpm@9 --filter @internshannon/web run desktop:smoke
```

只验证本 PR 涉及的个人技能和真实 WebSocket 加载链路：

```bash
PUBLIC_DESKTOP_URL=http://127.0.0.1:5001 \
npx pnpm@9 --filter @internshannon/web run desktop:skill-smoke
```

该命令经 web proxy 创建临时个人 `SKILL.md` 和会话，强制使用 websocket
transport，校验 `session_status.data.skills` 后在 `finally` 中清理 fixture。

`PUBLIC_DESKTOP_DEV_PORT` 和 `PUBLIC_DESKTOP_URL` 必须使用同一端口。前者控制
Rsbuild 监听地址，后者会进入 desktop web 配置；只改一个会造成页面地址、
代理或运行时 URL 不一致。

## 5. 启动新部署

默认端口空闲时：

```bash
npx pnpm@9 --filter @internshannon/sidecar run start
npx pnpm@9 --filter @internshannon/web run preview
```

开发模式：

```bash
npx pnpm@9 --filter @internshannon/sidecar run start:dev
npx pnpm@9 --filter @internshannon/web run desktop:dev
```

启动后检查健康状态：

```bash
curl --fail http://127.0.0.1:29653/api/v1/health
curl --fail --head http://127.0.0.1:5000/
```

如果使用了 5001，把第二条命令的端口同步改为 5001。

## 6. CLOSE_WAIT

`lsof -nP -i:29653` 可能显示浏览器留下的 `CLOSE_WAIT` 连接。它们不是监听
进程，不妨碍重新部署。端口检查只以 `-sTCP:LISTEN` 的结果为准。

## 7. 部署前验收

- `scripts/predeploy-check.sh check` 对目标端口给出明确结果；
- 未识别进程只输出详情，不收到 `SIGTERM` / `SIGKILL`；
- sidecar health 返回 200；
- web root 和静态资源返回 200；
- 使用非默认 web 端口时，`PUBLIC_DESKTOP_DEV_PORT`、`PUBLIC_DESKTOP_URL`
  和 smoke 命令保持一致。
