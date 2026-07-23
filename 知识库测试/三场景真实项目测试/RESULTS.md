# 多场景真实项目测试结果

## 测试工程独立复跑（2026-07-22）

- 在叠加于固定产品提交的独立 worktree 中，使用全新 Sidecar 数据目录和独立 Web storage prefix 运行 `renewal-operations`。
- 显式设置 `KB_SCENARIO_SKIP_DIALOGUE=1`，不复制个人模型配置；编排器使用只为解锁首次 UI 的临时不可达模型，确认跳过对话模式不依赖 API key，也不会调用模型。
- 结果为 `passed_with_skips`：64 项中 63 passed、1 项（真实 WebSocket 模型对话）skipped、0 failed。真实观察 `running + queued`，两任务均到达 `cancelled`；OKF/MCP 扩展探针 8 项、浏览器 Office 修改/保存/重开、策展冲突与撤销均通过。
- 此次复跑用于验证提交中的测试编排器可独立运行，不替代 2026-07-21 的 30 分钟诊断、4 小时长稳和真实模型场景证据。机器报告与原始日志均为本机生成产物，受 `.gitignore` 保护，不进入 PR。

## PowerPoint 图形与滚轮修复回归（2026-07-15 18:52）

- Web 根因修复：Univer Slides 0.24 的真实 viewport key 是 `__mainView__`，通用 Canvas 滚轮处理器查找 `viewMain`；兼容层现在同时覆盖 render 延迟创建和 viewport 延迟注册，并在 PPTX runtime 销毁时恢复原方法。
- 真实网页：`raw/sources/测试ppt.pptx` 的第二页蓝色矩形已显示；滚轮复测前后浏览器 error 数不变，新增 `onMouseWheel$` 错误为 0。网页写入 `2233-SHUXIAOAN-PPT-ROUNDTRIP-20260715` 后保存成功。
- PPTX 结构：夹具已替换为 PowerPoint 16.110.3 原生文件；结构契约覆盖 2 slides、1 master、11 layouts、1 theme、Content Types、完整 relationship 链，以及矩形非可视属性、坐标、几何和 `accent1` 主题填充。
- Microsoft PowerPoint：从知识库 API 提取书小安保存后的副本，无修复提示打开；识别每页 2 个 shape 和第二页 `Rectangle 4`。PowerPoint 写入 `POWERPOINT-REOPEN-ROUNDTRIP-20260715`、保存、关闭、重开后标记可读，结构仍为 2/1/11/1 和 16 个关系文件。
- 三个隔离真实项目 Run ID `20260715185200-pptx-node22`：续费运营 64/64、五论文研究 61/61、发布事故复盘 56/56，共 181 passed、0 skipped、0 failed；LibreOffice 按用户要求未重跑。
- 分层回归：Sidecar 53 suites / 312 passed / 1 skipped，Web（Node 22）662/662，OOXML 13/13；DDD boundary、Sidecar build 297 files、Web production build、OOXML TypeScript 和 `git diff --check` 通过。
- 机器报告：`latest-isolated-report.json` 与 `../外部依赖真实验收/latest-microsoft-office-report.json`；提取和 PowerPoint 往返副本位于本机忽略目录 `../外部依赖真实验收/runs/manual-powerpoint-20260715-1845/`。

## LibreOffice 外部往返基线（2026-07-15 17:07）

- 正式 LibreOffice 26.2.4.2 安装于当前用户 `~/Applications/LibreOffice.app`；安装包 SHA-256 与 Document Foundation 公布值一致，为原生 arm64 且通过 macOS Notarized Developer ID 验证。
- 独立保真套件 Run ID `20260715090243`：DOCX/XLSX/PPTX 三个过滤器探针和三个业务内容场景共 12/12 通过。Writer 保留表格、Calc 保留公式、Impress 保留幻灯片主体，三种格式均验证“书小安导出 → LibreOffice 导入/修改/导出 → 书小安再保存 → LibreOffice 再次重开”。
- 完整隔离项目 Run ID `20260715170447`：客户续费 67/67、五论文研究 64/64、Orion 事故复盘 59/59，合计 190 passed、0 skipped、0 failed。
- 每个项目均使用全新 Sidecar 数据目录，完成 OKF、摄取、检索和引用、`running + queued` 双取消、策展 SHA 冲突/恢复、MCP、真实 WebSocket 对话，并额外要求三个 Office 文件经 LibreOffice 往返后再在书小安网页修改、保存、关闭和重开。
- 分层回归：LibreOffice 工具单元测试 6/6，Sidecar 53 suites / 312 passed / 1 skipped，Web 657/657，OOXML 9/9；Sidecar/OOXML TypeScript、DDD boundary、Sidecar build 297 files、Web production build 和 `git diff --check` 通过。
- 机器报告：`../外部依赖真实验收/latest-libreoffice-report.json` 和 `../外部依赖真实验收/latest-libreoffice-scenarios-report.json`；原始日志位于已忽略目录 `../外部依赖真实验收/runs/libreoffice-scenarios/20260715170447/`。

## 最新真实外部依赖基线（2026-07-15 14:32）

- Run ID：2026071508。
- 四个项目分别使用全新 Sidecar 数据目录，真实 OCR 为 Tesseract 5.4.1 custom HTTP provider，真实 embedding 为 boyue/text-embedding-3-small（1536 维）。
- 最终状态：passed，248 条机器检查全部通过，0 skipped、0 failed。
- 机器汇总：../外部依赖真实验收/latest-real-provider-report.json；原始日志位于本机忽略目录 ../外部依赖真实验收/runs/2026071508/。

| 隔离场景 | 检查数 | OCR 来源 | 纯语义问题分数 | 零命中 | 真实 WebSocket |
| --- | ---: | --- | ---: | --- | --- |
| 客户续费运营 | 66 | indexed / 可搜索 | 0.4485 | 0 hits | marker/fact/citation |
| 五论文研究 | 63 | indexed / 可搜索 | 0.3976 | 0 hits | marker/fact/citation |
| Orion 发布复盘 | 58 | indexed / 可搜索 | 0.4072 | 0 hits | marker/fact/citation |
| InternShannon 文档交付 | 61 | indexed / 可搜索 | 0.5789 | 0 hits | marker/fact/citation |

本轮真实外部验收结论：

- 每场景 manifest 都明确记录 boyue、text-embedding-3-small 和 1536 维，非 local-hash-v1；每个 PNG 都记录 extractionMethod=ocr、ocrBackend=tesseract-http 并能按唯一 OCR marker 搜索。
- 四个没有原文精确短语的自然语言问题均命中正确项目证据，semantic score 全部超过 0.30；随机标识符查询保持 0 hits。
- 外部 embedding 首轮暴露随机标识符被最近邻错误命中的产品缺陷。修复后，自然语言纯语义命中要求外部 cosine 至少 0.30；带字母数字的标识符查询还必须具有规范化 token 锚点。
- WebSocket 客户端现在只自动批准 knowledge_search / knowledge_read 只读确认；其他工具明确拒绝。最终四轮预接地日志均为 hits=8 read=yes，回答 marker、关键事实和 citation 通过。
- OCR 独立质量探针：清晰英文 100%、中英混合 96.77%、低对比旋转件 100%、扫描 PDF 100%，机器报告见 ../外部依赖真实验收/latest-ocr-quality-report.json。
- Microsoft Office 16.110.3：Word DOCX 和 Excel XLSX 在真实应用中修改、原位保存、OOXML 复读通过，并保留表格和公式；PowerPoint GUI/AppleEvent 仍无法打开测试演示文稿。LibreOffice 26.2.4.2 已另行完成 Writer/Calc/Impress 真实往返，见 ../外部依赖真实验收/latest-microsoft-office-report.json 和 latest-libreoffice-report.json。

分层回归：Sidecar 53 suites / 312 passed / 1 skipped，Web（Node 22）657/657，OOXML 9/9；Sidecar build 297 files、Web production build、DDD boundary、OOXML TypeScript 和 git diff --check 通过。

## 本地 fallback 隔离基线（2026-07-15 12:54）

- Run ID：`20260715051117`
- 执行方式：四个项目分别启动全新 Sidecar 数据目录；Web 固定代理到当前隔离 Sidecar，场景结束后自动停止进程并删除临时数据。
- 最终状态：`passed`，240 条机器检查全部通过，0 skipped、0 failed。
- 稳定汇总：`latest-isolated-report.json`；每场景原始报告和 Sidecar/runner 日志位于本机忽略目录 `isolated-runs/20260715051117/`。

| 隔离场景 | 检查数 | 来源与项目内容 | running + queued | 策展冲突/恢复 | Office 浏览器重开 | 真实 WebSocket |
| --- | ---: | --- | --- | --- | --- | --- |
| 客户续费运营 | 64 | TXT/CSV/DOCX/XLSX/PPTX/PNG | 两任务均 cancelled | 409 后保留手工内容并恢复 | 3/3 | marker/fact/citation |
| 学术文献研究 | 61 | 5 篇真实 PDF + 混合来源 | 两任务均 cancelled | 409 后保留手工内容并恢复 | 3/3 | marker/fact/citation |
| Orion 发布复盘 | 56 | 发布计划、风险表和 Office | 两任务均 cancelled | 409 后保留手工内容并恢复 | 3/3 | marker/fact/citation |
| InternShannon 文档交付 | 59 | DESIGN、roadmap、实施记录和 Office | 两任务均 cancelled | 409 后保留手工内容并恢复 | 3/3 | marker/fact/citation |

本轮新增并通过：

- OKF ZIP 原始 entry 路径检查；`../../../outside.md` 现在明确返回 400，不再仅依赖 JSZip 静默清洗。
- OKF 直接路径穿越、损坏 YAML、缺失 type、空 bundle、5001 文件、解压后超过 20 MB 均以硬断言拒绝。
- MCP JSON-RPC initialize、tools/list、未知方法、错误版本和非法 JSON 探针通过。
- 学术场景从 3 篇扩展到 `ASM-Loc`、`E2E-TAD`、`FTCL`、`P-MIL`、`RSKP` 5 篇真实 PDF。
- 每个上传文件在读取后重新计算 SHA-256；Office 在 Edge 中修改、保存、切换离开、重新打开，并复读 OOXML 标记。
- 四轮均使用 `boyue/gpt-5` 和 WebSocket transport；回答必须包含当前场景唯一标记、关键事实 token、可定位引用，并不得出现其他场景标记。
- 报告状态现在区分 `passed`、`passed_with_skips`、`failed`，最终勾选由断言和退出码生成，不再由人工 `echo` 汇总。
- 多轮复跑暴露 Univer Slides 0.24 的 300ms 缩略图回调未随 dispose 取消；Office runtime 销毁增加 400ms grace period。Orion 单场景复现和最终四场景顺序均无 `getPageOrder`、console error 或 pageerror。

分层回归：Sidecar `53 suites / 310 passed / 1 skipped`，Web（Node 22）`657/657`，OOXML `9/9`；Sidecar build 297 files、Web production build、DDD boundary、OOXML TypeScript 和 `git diff --check` 通过。

## 历史三场景基线（2026-07-15 12:13）

- 日期：2026-07-15
- Run ID：`20260715035107`
- 数据目录：隔离临时目录，未修改 `~/.internshannon` 主数据
- API：`http://127.0.0.1:29683`
- Web：`http://127.0.0.1:5011`
- 最终结果：通过
- 机器可读证据：`latest-report.json`

## 项目结果

| 场景 | 唯一事实 | 混合摄取 | running + queued | 策展接受/撤销 | MCP search/read | WebSocket 对话 |
| --- | --- | --- | --- | --- | --- | --- |
| 客户续费运营 | `RENEWAL-BQ3-7429` | succeeded | 真实观察，2 任务均 cancelled | 精确恢复 | 正例、读取、零命中通过 | 标记与引用通过 |
| 学术文献研究 | `RESEARCH-ASMLOC-317` | succeeded，3 篇真实 PDF 已抽取 | 真实观察，2 任务均 cancelled | 精确恢复 | 正例、读取、零命中通过 | 标记与引用通过 |
| 软件发布复盘 | `RELEASE-ORION-731` | succeeded | 真实观察，2 任务均 cancelled | 精确恢复 | 正例、读取、零命中通过 | 标记与引用通过 |

## 完整链路

三个场景均完成：

- 导入 3 个带相对链接的 OKF 页，校验图谱节点和方向边。
- 上传 TXT、CSV、DOCX、XLSX、PPTX 和 PNG；学术场景额外摄取 `ASM-Loc.pdf`、`E2E-TAD.pdf`、`FTCL.pdf`。
- TXT/CSV/DOCX/XLSX/PDF 产生真实 chunk，PPTX 明确标记 unsupported，未配置 OCR 的 PNG 标记 `waiting_for_ocr`。
- 每个场景上传两份约 4 MiB 来源，实际观察到一个 `running` 和一个 `queued`，取消后均到达 `cancelled`。
- 搜索唯一标记、citation、recall@K、零命中和 MCP `knowledge_search -> knowledge_read` 通过。
- summary proposal 接受后改变原页，撤销后字节精确恢复；刷新后建议恢复 `pending`。
- source-page proposal 接受前不创建页面，接受后包含 `asset://` citation，撤销后页面删除。
- OKF validate/export ZIP/重复导入不覆盖、存储迁移二次为 0、审计和默认检索配置恢复通过。
- 每个场景的 DOCX、XLSX、PPTX 均在真实 Edge 页面中修改、进入“未保存”、保存，再从后端读取 OOXML 字节确认唯一 UI 标记存在，共 9/9 通过。
- 三个 `boyue/gpt-5` 独立会话均使用真实 WebSocket transport，回答包含对应项目标记和可定位引用。

## 测试发现与修复

1. 长 PDF 语料下 `local-hash-v1` 的 192 维哈希碰撞会将未知随机标记误判为语义命中。修复后，本地哈希的纯语义命中必须同时具有归一化 token 重合；内置同义词依然可命中，外部真实 embedding 不受该门槛限制。
2. 多 chunk PDF 搜索结果使用相同 `path` React key，导致重复 key 和可能的列表错位。已按 path 保留排名最高的 chunk。
3. Web 同时打包 Univer ESM 和 OOXML CJS 间接引入的 Univer CJS，造成 Redi 运行时加载两次。已在 Rsbuild 将 Core/Slides 统一到 ESM 入口。修复后连续 Office 切换的 `console error/pageerror` 为 0。

## 标准回归

- Sidecar Jest：53 suites，309 passed，1 skipped。
- Web desktop state：657/657 passed。
- OOXML Jest：9/9 passed。
- Sidecar 与 OOXML TypeScript：通过。
- DDD boundary：通过。
- Sidecar build：通过，297 files。
- Web production build：通过。
- `git diff --check`：通过。

## 当轮未覆盖项（历史）

- 真实 OCR provider 仍未配置；本轮只验证了三个场景的 `waiting_for_ocr`，没有把 mock 当成真实后端验收。
- 外部真实 embedding provider 未运行；三场景使用默认 `local-hash-v1`。
- PowerPoint/LibreOffice 外部应用矩阵本轮未重复；本轮 Office 验收是书小安页面中的真实编辑和 OOXML 字节复读。
