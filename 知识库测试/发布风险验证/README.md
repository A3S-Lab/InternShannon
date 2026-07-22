# 知识库发布风险验证

本目录保存知识库发布候选的可复用验证链路。测试只使用临时目录、隔离端口或测试副本，不修改用户个人知识库；不自动提交、推送或评论 PR。升级/回退基线由 `KB_BASELINE_SIDECAR_ENTRY`、`KB_BASELINE_REPO_ROOT` 和 `KB_BASELINE_COMMIT` 显式指定，不绑定个人路径或历史提交。

## 完成标准

- 每项结果必须区分 `passed`、`failed`、`blocked`、`not_run`，环境缺失不得记为通过。
- 产品缺陷修复后先复跑定向测试，再执行对应阶段回归。
- 最终报告必须绑定候选工作区内容摘要，避免测试报告与实际准备推送的代码不一致。
- Office 保真测试的目标是“支持的内容可编辑，暂不支持的内容不得静默丢失”。

## P0：下一次推送前发布门禁

状态：本机可执行项已完成；签名/公证和被现有用户进程占用固定端口的 `.app` 全 GUI 启动保留为未执行/阻塞。

1. 候选工作区指纹与全量回归
   - 记录 `HEAD`、远端 upstream、tracked diff、候选 untracked 文件及 SHA-256。
   - 运行 Sidecar、Web、OOXML、DDD、Sidecar/Web production build、diff check。
   - 运行隔离真实项目快速回归，确认测试不依赖个人数据目录。
2. 升级与回退
   - 使用显式指定的真实基线 Sidecar 创建旧版知识库数据。
   - 新代码在同一数据目录启动，验证来源 SHA、搜索引用、旧任务和索引重建。
   - 再以相同基线启动，验证回退至少不会破坏 raw source；新格式不可读时必须给出明确诊断。
   - 覆盖升级过程强制退出和再次启动。
3. 正式桌面包
   - 构建 Tauri `.app`，校验 bundle 中 Web、Sidecar 和 Node 资源。
   - 从 bundle 资源隔离启动 Sidecar，验证健康检查和知识 API。
   - 分别使用全新 profile 和升级 profile 启动桌面包，检查启动、重启和路径权限。

## P1：平台、故障与长稳

状态：本机可执行项已完成。Windows/Linux 真实运行环境和 4–8 小时扩展长稳未执行，明确记为阻塞/未运行。

1. 兼容矩阵
   - macOS arm64 本机执行完整门禁。
   - Windows x64、Linux x64/arm64：优先使用可用 runner/container；没有真实环境时执行可交叉验证的路径、资源布局和构建契约，并记为 `blocked`，不得冒充真实平台通过。
2. 故障点
   - chunks/vector/manifest 提交前后取消或失败。
   - manifest/vector 损坏后的安全恢复。
   - 磁盘只读、部分写失败、策展 accept/revert 失败。
   - 断言旧 manifest 不指向未完成的新 revision，raw source SHA 不变。
3. 并发与长稳
   - 至少 8 路并发上传/检索/取消/重建。
   - CI 档持续数分钟并记录 p50/p95/p99、RSS、文件句柄和错误数。
   - 提供 4–8 小时扩展档命令；本轮实际执行时长写入报告。

## P2：复杂保真、Provider 故障和大图谱

状态：已完成。大型图谱与 Provider 故障矩阵通过；复杂 DOCX/XLSX 已使用 package-preserving 写回保留原包未知 part，并在无法安全映射的结构/格式修改上阻止保存、明确提示。

1. 复杂 Office 黄金文件
   - DOCX：表格、页眉页脚、图片/关系、批注或修订相关 part。
   - XLSX：公式、合并单元格、样式、图表/关系。
   - PPTX：图片、表格、图表、组合图形、旋转、渐变、超链接、主题和关系。
   - 书小安修改支持的文本后，逐 part 校验未支持内容不丢失；可用时交给 Microsoft Office 重新打开。
2. Provider 故障矩阵
   - embedding：超时、429、5xx、401、畸形 JSON、向量数量/维度错误、provider 切换。
   - OCR：超时、429、5xx、空文本、扫描 PDF 多页错误。
   - 检查重试、retryable 状态、错误脱敏和旧索引保留。
3. 1000 节点图谱与可用性
   - 真实浏览器加载、过滤、关系卡点击、端点/箭头高亮、缩放和滚轮。
   - 记录首次可交互耗时、操作耗时、console/pageerror 和浏览器内存可获得项。
   - 检查键盘焦点、主要控件可访问名称以及窄窗口基本可用性。

## 产物

- `latest-release-risk-summary.json`：总结果。
- `latest-candidate-fingerprint.json`：候选工作区绑定信息。
- `latest-upgrade-rollback-report.json`：升级、回退与中断恢复。
- `latest-packaged-desktop-report.json`：打包桌面验证。
- `latest-platform-report.json`：平台矩阵。
- `latest-fault-matrix-report.json`：故障注入。
- `latest-concurrency-soak-report.json`：并发与长稳。
- `latest-office-fidelity-report.json`：复杂 Office。
- `latest-provider-failure-report.json`：Provider 故障。
- `latest-large-graph-report.json`：大型图谱和可用性。

## 2026-07-16 最终执行结果

- P0：升级/回退 8/8，通过；5 个隔离真实项目 296/296，通过；最新无签名 macOS arm64 `.app` 构建及 bundle-resource Sidecar 健康探针通过。全新/升级 profile 的 `.app` GUI 启动因用户现有健康 Sidecar 占用固定 29653 端口而未强行执行，独立 Sidecar profile 的升级/回退已覆盖数据兼容。
- P1：只读存储、vector/manifest 写失败、策展 accept/revert 中断恢复全部通过。最终 16 worker 完整链路先完成 30 分钟诊断（61,939 请求、19 次重建、0 错误、p95 798.57 ms），再完成 4 小时长稳（503,053 请求、153 次重建、0 错误、p95 789.39 ms、p99 839 ms），随后 P0/P1 13/13 通过。Windows/Linux 真实 runner 仍未执行。
- P2：embedding/OCR 错误、超时、重试、取消、脱敏和 provider 切换契约通过；1001 节点/2000 边真实浏览器图谱通过。PPTX 支持的文本编辑保留 master/layout/theme/关系；DOCX 页眉/媒体及 XLSX chart/drawing/媒体在支持的正文/单元格编辑后逐 part 保留，无法安全映射的复杂结构/样式修改会被拒绝保存。
- 最终代码门禁：Sidecar 53 suites / 342 passed / 1 skipped；Web 663/663；OOXML 18/18；OCR 12/12；Rust 15/15；DDD、Sidecar 297-file build、Web production build、`git diff --check` 均通过。
- 环境结论不得扩大：本轮通过的是 macOS 15.0 arm64 本机候选；无签名/未公证、Windows/Linux、未配置的生产 OCR/embedding provider 和所有复杂 Office 对象都可编辑仍不是通过状态。

## 候选一致性说明

长稳期间另一个开发会话修改过 Kernel 模型策略和 AI provider UI，因此历史 4 小时报告只能证明启动时 Sidecar 构建中的知识检索与重建链路，不能单独证明后来工作区的所有文件。整理 PR 时已把这些无关变更排除，并在固定产品分支上重新执行完整 Sidecar、Web、OOXML、OCR、DDD 和生产构建。后续发布候选若再改动知识检索、索引提交点或持久化格式，应重新执行“30 分钟诊断 → 4 小时长稳 → P0/P1”；仅文档或测试脚本变化无需重复 4 小时长稳。
