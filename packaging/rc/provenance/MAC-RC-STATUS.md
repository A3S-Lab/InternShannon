# 书小安 macOS arm64 KC3 内部预览状态

结论：**打包完成，但 RC 验收未 GO；仅可作为内部预览包。**

## 冻结身份

- App 源码快照：`4d6f9430c92aa492f3b301a410553046ab6ee980c285a047362d234d83728ea3`（1350/1350 文件逐项一致）。
- 受控 SDK：`@a3s-lab/code@6.6.1-knowledge-complete.3`。
- A3S source revision：`07707ad74785f940e6579d692d7f142c13231040`。
- A3S source tree SHA-256：`3321cde6cd7d6b7c1439f09d22d7449b501dc8200fdbbbfe09a5334f5d83fc62`。
- darwin-arm64 TGZ SHA-256：`1119c3649a6b3308acc9b692f14aedcc77ecc4db76d7c3f28aadd5d25eca29eb`。

## 已通过

- 离线 `frozen-lockfile` 安装。
- 桌面发布合同 33/33。
- Sidecar `tsc --noEmit`（执行既定 `prepare:workspace` 后 0 错误）。
- arm64 主程序编译及 App bundle 生成。
- Sidecar standalone resources verifier。
- 受控 SDK、版本和 `index.darwin-arm64.node` verifier。
- Lightpanda `0.3.1@85d84c…` 版本与 SHA-256 verifier。
- standalone health、知识库/HITL mock WebSocket、手动压缩、禁止自动切模、429 生命周期 smoke。
- 深度 ad-hoc 签名及 `codesign --deep --strict`。
- app.zip 完整性、DMG checksum、DMG 挂载后 19,889 条目逐项 parity。
- 最终签名 App 启动、原生窗口创建、`/api/v1/health` 200、退出后 29653 端口释放。
- 最终包的 01 验收工具 preflight：`boyue/gpt-5`、`automaticModelSwitch=false`、14 个批准来源、脚本 28 个总问题（其中核心 0/A/B/C 为 23 轮）、300000ms/15000ms/max-failed-rounds=1；执行轮数为 0，Provider 未调用。
- 60 个文本证据文件密钥扫描：0 命中；未复制 `config.json`。

## 唯一确定性产品阻断

`smoke-unicode-provider-websocket --verify-compact-suite` 两次独立执行（构建内门禁一次、定向机械复现一次）均在同一位置失败：

> Second rolling summary did not receive the previous summary

含义：Sidecar 重启后，第二轮滚动压缩请求没有携带第一轮摘要。失败已封存；同一版本不再重跑。

因此本版本没有调用真实 Provider，也没有运行无知识库真实会话或 `01-会话问题脚本.md`。这不是 23/23 或 A-1～A-6 通过证据。

## UI 截图

App 窗口由 macOS 报告为 1240×845，但窗口服务器持续返回 `kCGWindowSharingState=0`。系统窗口截图被拒绝，全屏截图只得到桌面；三张无效桌面图已删除，未作为证据。详见 `UI-CAPTURE-BLOCKED.md`。

## 安装注意

用户手动保留的 `/Applications/InternShannon 2.app` 来自首次 DMG 工具失败前的中间 App：它不包含已验证 Lightpanda，且未通过最终严格签名门禁。该 App 未被修改或删除，但不应视为本次最终预览包。

本次可验证包位于 `packages/`。旧 `/Applications/InternShannon.app` 的回退 ZIP 位于 `rollback/`。

## 恢复入口

先在共享受控 A3S 源码修复“跨 Sidecar 重启的滚动摘要持久化”，创建新的、同时覆盖 darwin-arm64 与 win32-x64 的共同 source revision/sourceTree/version；然后重新构建两平台并从本地门禁开始。只有 compact suite 转绿后，才允许执行真实无知识库会话、A 连续会话及最终 01 核心测试。
