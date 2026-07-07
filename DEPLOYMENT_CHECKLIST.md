# 书小安部署前检查清单

每次在网页端做新的部署（重新构建 + 重启 preview / 重启 sidecar）之前，必须按本清单检查并清理已有进程，避免端口占用、版本错乱、僵尸进程残留导致行为异常。

> 适用范围：本地开发与本地部署。生产部署另有 CI 流程，不在此列。

## 1. 必检端口

| 端口 | 服务 | 检查命令 |
|---|---|---|
| `29653` | sidecar API（NestJS） | `lsof -nP -iTCP:29653 -sTCP:LISTEN` |
| `5000`  | 前端 preview（rsbuild preview） | `lsof -nP -iTCP:5000 -sTCP:LISTEN` |
| `29654` | sidecar dev 备用端口（部分老配置） | `lsof -nP -iTCP:29654 -sTCP:LISTEN` |

每个命令应该没有输出（端口空闲）。如果出现 `COMMAND PID USER ... (LISTEN)`，说明有进程占用，需要按下面步骤清理。

## 2. 必检进程

部署前应确保没有遗留的 `InternShannon.app` / sidecar / rsbuild preview 进程：

```bash
ps aux | grep -E "InternShannon\.app|rsbuild.*preview|sidecar.*main\.js|@internshannon/sidecar" | grep -v grep
```

期望输出：**空**。

如果有输出，先记录 PID，按下面"清理"小节的步骤逐个处理。

## 3. 清理步骤（按顺序执行）

### 3.1 优雅停止 sidecar（端口 29653）

```bash
# 找到监听进程 PID
SIDECAR_PID=$(lsof -nP -iTCP:29653 -sTCP:LISTEN -t 2>/dev/null)

# 优雅退出
[ -n "$SIDECAR_PID" ] && kill -TERM "$SIDECAR_PID"
sleep 2

# 确认已退出
lsof -nP -iTCP:29653 -sTCP:LISTEN || echo "✅ 29653 released"
```

### 3.2 优雅停止前端 preview（端口 5000）

```bash
PREVIEW_PID=$(lsof -nP -iTCP:5000 -sTCP:LISTEN -t 2>/dev/null)
[ -n "$PREVIEW_PID" ] && kill -TERM "$PREVIEW_PID"
sleep 2
lsof -nP -iTCP:5000 -sTCP:LISTEN || echo "✅ 5000 released"
```

### 3.3 兜底：强制杀残留

如果上面 `kill -TERM` 后端口仍被占用：

```bash
# 找出所有相关 PID
PIDS=$(lsof -nP -iTCP:29653,5000 -t 2>/dev/null | sort -u)
[ -n "$PIDS" ] && echo "$PIDS" | xargs kill -KILL
```

> ⚠️ `kill -KILL`（即 `kill -9`）不留给进程清理机会，只在前者无效时使用。`rsbuild preview` 和 NestJS 通常能优雅响应 SIGTERM，不需要 KILL。

### 3.4 关闭整个桌面应用（如果是用 .app 启动的）

如果是从 `/Applications/InternShannon.app` 启动的，单独 kill 监听端口可能不够——某些版本会通过 launchd 自动重启。这种情况下：

```bash
# 通过 osascript 优雅退出整个 .app
osascript -e 'tell application "InternShannon" to quit' 2>/dev/null
sleep 2

# 验证没有残留
ps aux | grep "InternShannon\.app" | grep -v grep || echo "✅ no .app process"
```

## 4. 残留检查

完成清理后，再跑一次全面检查：

```bash
# 1. 端口空闲
lsof -nP -iTCP:29653 -sTCP:LISTEN && echo "❌ 29653 仍被占用" || echo "✅ 29653 free"
lsof -nP -iTCP:5000  -sTCP:LISTEN && echo "❌ 5000 仍被占用"  || echo "✅ 5000 free"

# 2. 进程清理
ps aux | grep -E "InternShannon\.app|rsbuild.*preview|@internshannon/sidecar" | grep -v grep \
  && echo "❌ 仍有相关进程" || echo "✅ 无相关进程"
```

两个 ✅ 才能继续部署。

### 4.1 关于 `CLOSE_WAIT` 残留

清理后 `lsof -nP -i:29653`（注意去掉 `-sTCP:LISTEN`）可能仍看到几条 `CLOSE_WAIT` 状态的连接，COMMAND 通常是浏览器（`Microsoft Edge` / `Google Chrome`）。这是浏览器侧 TCP 还没完全关闭，属于被动状态，会被 OS 在 keepalive 失败后清掉，**不影响新部署**。

刷新或关闭浏览器标签页可立即清掉这些残留。

## 5. 启动新部署

确认清理干净后，按需启动：

```bash
# 方案 A：极速预览模式（已构建产物）
npx pnpm@9 --filter @internshannon/sidecar run start       # 后端
npx pnpm@9 --filter @internshannon/web    run preview      # 前端

# 方案 B：开发热更新模式
npx pnpm@9 --filter @internshannon/sidecar run start:dev   # 后端
npx pnpm@9 --filter @internshannon/web    run desktop:dev   # 前端
```

启动后再次核对端口监听状态：

```bash
lsof -nP -iTCP:29653 -sTCP:LISTEN && echo "✅ sidecar up"
lsof -nP -iTCP:5000  -sTCP:LISTEN && echo "✅ preview up"
```

## 6. 一键检查脚本（可选）

把上面的检查 + 清理封进一个脚本，每次部署前跑一遍：

```bash
# scripts/predploy-check.sh
#!/usr/bin/env bash
set -e

echo "=== 检查端口 ==="
for port in 29653 5000; do
  if lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; then
    pid=$(lsof -nP -iTCP:$port -sTCP:LISTEN -t 2>/dev/null | head -1)
    echo "❌ 端口 $port 被 PID $pid 占用，发送 SIGTERM"
    kill -TERM "$pid" 2>/dev/null || true
  else
    echo "✅ 端口 $port 空闲"
  fi
done

sleep 2

echo "=== 复查 ==="
for port in 29653 5000; do
  if lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; then
    echo "❌ 端口 $port 仍被占用，需要手动处理"
    lsof -nP -iTCP:$port -sTCP:LISTEN
    exit 1
  fi
done

echo "=== 检查残留进程 ==="
if ps aux | grep -E "InternShannon\.app|rsbuild.*preview|@internshannon/sidecar" | grep -v grep >/dev/null; then
  ps aux | grep -E "InternShannon\.app|rsbuild.*preview|@internshannon/sidecar" | grep -v grep
  echo "❌ 仍有残留进程，请手动清理"
  exit 1
fi

echo "✅ 部署前检查通过"
```

## 7. 已知坑点

- **`InternShannon.app` 自动重启**：某些版本通过 launchd 注册了 KeepAlive，单独 kill 监听端口会被立刻拉起。需要先 `osascript ... to quit` 整个 .app。
- **多个 preview 实例**：连续 `pnpm preview` 多次可能跑出多个监听 5000 的 node 进程；按 PID 逐个杀。
- **CLOSE_WAIT 不影响监听**：检查时只看 `-sTCP:LISTEN`，不要被 CLOSE_WAIT 吓到。
- **端口被其他程序占用**：如果 5000 被 macOS 控制中心（`ControlCe`）占用，需要换端口或停掉对应服务。
