# 知识库实施跟踪

> 目的：持久记录知识库开发目标、决策、进度、验证结果与回退点。每完成一个可验证阶段，先更新本文档，再继续实施，避免对话上下文丢失成为项目风险。

## 基线

- 建档日期：2026-07-10
- 工作分支：`fix/skill-loading-and-deployment-checklist`
- 建档时 HEAD：`da9f182`
- 远端 roadmap：`origin/main:docs/knowledge-base-roadmap.md`，提交 `f094a21`
- 工作区既有改动：`scripts/predeploy-check.sh`、`scripts/predeploy-check.spec.mjs`、`SKILL.md`、`知识库测试/`
- 保护约束：上述既有改动不属于知识库实施范围，不覆盖、不回退、不清理。

## 工作目标

1. 数据安全：PDF、图片、Office 等二进制来源在上传、读取、保存后字节不损坏。
2. 直接编辑：知识库资产中的常用 Office 文件可复用 UniverJS 打开、编辑、保存和重新打开。
3. OKF 兼容：以 `wiki/` 作为 Open Knowledge Format v0.1 bundle 根，支持校验、导入、导出和未知字段无损往返。
4. 智能对话：默认助手能够搜索、读取和引用 OKF concept；无命中时不得声称参考过知识库。
5. 可检索摄取：原始来源与用户知识分离，建立 source manifest、文本抽取、chunk 和真实 reindex。
6. 可扩展存储：正文不再持续膨胀 `metadata.blobContents`，列表和健康度接口不传输全部正文。
7. 可解释增强：在基础闭环稳定后增加混合检索、图谱和可审计的自动策展。

### 三项核心目标约束

以下三项是用户确认的产品主线，后续阶段不得用工程增强项替代或弱化。用户所说的 Office 类插件按项目现有实现统一指 UniverJS/OOXML 能力，不另建一套编辑器。

1. **直接编辑能力**：DOCX、XLSX、PPTX 在知识库文件树中可打开、编辑、保存、关闭后重新打开；不支持或不能保真的格式必须明确只读/不支持。
2. **OKF 格式支持**：`wiki/` 始终是 Open Knowledge Format v0.1 bundle 根；导入、编辑、校验、导出必须保留正文、链接、未知 `type` 和未知 frontmatter 字段。
3. **智能对话调用 OKF**：默认助手回答知识库问题前必须调用真实的 `knowledge.search/read/list/tags` 能力；回答必须返回可定位引用，无命中时明确说明未找到。

所有后续阶段都必须通过上述三项的回归门禁。OCR、异步任务、embedding、图谱和自动策展服务于这三项，不改变 `raw/sources/` 与 `wiki/` 的边界，也不允许自动内容静默覆盖用户维护的 OKF 页面。

## 目标结构

```text
knowledge asset
├── raw/sources/                       # 原始来源，允许二进制
├── wiki/                              # OKF bundle root
│   ├── index.md
│   ├── log.md
│   └── **/*.md                        # OKF concepts
└── .internshannon/knowledge/index/    # manifest、抽取文本和 chunk 等派生索引
```

## 实施阶段

### Phase 0：数据与编辑安全

- [x] 建立二进制 blob 读写契约，保留 encoding、bytes、sha、size、mime。
- [x] 修复知识库来源上传的 UTF-8 强制解码损坏。
- [x] 关闭知识库 Markdown 富文本模式，保证 YAML frontmatter 往返安全。
- [x] 从用户文件树过滤 `.shuan-os-snapshots`。
- [x] 修复 broken links、orphan pages 和 reindex 假成功提示的最低限度问题。

验收：二进制上传前后 SHA 一致；`wiki/index.md` frontmatter 不损坏；内部快照目录不可见；健康度数据真实。

### Phase 1：Office/Univer 直接编辑

- [x] 为 `asset://` 工作区实现二进制读取和写入。
- [x] 在知识库文件树复用 DOCX、表格和 PPTX Univer 面板。
- [x] 保存后生成 asset commit，并刷新来源 SHA/索引状态。
- [x] 对不支持或不能保真的格式明确只读/不支持状态。

验收：知识库中的 `.docx`、`.xlsx`、`.pptx` 可编辑、保存、关闭后重新打开，且文件仍可由外部 Office 工具读取。

### Phase 2：OKF 核心

- [x] 实现 OKF v0.1 类型、解析、校验与诊断。
- [x] 支持标准 Markdown bundle-relative/relative links，并兼容现有 `[[wikilink]]`。
- [x] 保留未知 frontmatter 字段，支持未知 `type`。
- [x] 实现目录/ZIP 形式的 OKF 导入与导出。
- [x] 调整 scaffold，使 `wiki/` 可作为 OKF bundle 使用。

验收：Google 官方示例 bundle 可导入；导出后重新导入不丢 concept、字段、正文或链接。

### Phase 3：搜索与智能对话

- [x] 实现关键词 `wiki/search`、`wiki/tags`、concept 读取和目录遍历。
- [x] 提供 `knowledge.search/read/list/tags` 只读工具。
- [x] 支持 personal、docs、global scope 和权限过滤。
- [x] 对话答案返回 bundle、path、title、snippet、resource/citation。
- [x] 无检索结果时明确返回未找到。

验收：默认助手回答个人知识库问题前调用知识工具，回答中的引用可以定位到具体 OKF concept。

### Phase 4：轻量摄取与存储收敛

- [x] 建立 source manifest：path、mime、sha、size、状态、抽取时间和 chunk 数。
- [x] 抽取 PDF、DOCX、XLSX/CSV 文本；OCR 不可用时标记等待，不伪装成功。
- [x] `wiki/reindex` 执行真实扫描、抽取、索引和健康度重建。
- [x] 派生内容写入专用索引目录，不写入用户 `wiki/`。
- [x] 新写入正文逐步退出 `metadata.blobContents`，保留旧资产兼容读取。

验收：上传来源后可以搜索原文句子；来源 SHA 变化触发重建；列表接口不携带全部正文。

### Phase 5：RAG、图谱与策展

- [x] 建立 embedding adapter、本地向量索引和 hybrid search。
- [x] chunk 可回溯到来源文件、页码/偏移和模型版本。
- [x] 图谱同时解析 OKF Markdown links 和 wikilinks，绘制真实边。
- [x] 自动建链进入 review 队列，不覆盖用户内容；摘要和页面生成沿用同一审阅边界，当前不主动生成。

基础验收：同义问题能命中并带来源；图谱关系真实；自动建链可接受、拒绝并留下策展审计记录。接受后的专用撤销流程和统一知识库审计已在 Phase 6 补齐，并覆盖“接受 -> 刷新建议 -> 精确撤销”的状态保持回归。

## 实施决策

- `raw/sources/` 保存原始文件；`wiki/` 保存用户和 agent 可读的 OKF 知识，不把自动摘要当作原文替代品。
- OKF v0.1 当前是 Draft，兼容层必须宽容读取、严格诊断、保留扩展字段。
- agent 内容检索使用独立 knowledge 工具，不把 `capabilities.search` 的 API operation 搜索伪装成知识搜索。
- 第一版先关键词检索和可靠引用，再增加 embedding。
- 所有自动生成内容都必须可追溯、可审计，不静默覆盖手写内容。

## 进度摘要

| 阶段 | 状态 | 当前结论 |
|---|---|---|
| 建档 | 已完成 | 实施目标、边界、阶段和验收标准已固化。 |
| Phase 0 | 已完成 | 二进制 base64 契约、原始字节上传、源码模式、快照过滤和真实链接健康度已落地。 |
| Phase 1 | 已完成 | `asset://` 已支持 base64 二进制读写，现有 Univer 面板可直接保存知识库 Office 文件。 |
| Phase 2 | 已完成 | OKF v0.1 校验、双链接、目录/ZIP 导入导出和 UI 命令已落地。 |
| Phase 3 | 已完成 | 真实 OKF 搜索/读取已接入 UI、HTTP 和 desktop capabilities 虚拟 knowledge 模块。 |
| Phase 4 | 已完成 | 来源按 SHA 增量抽取，manifest/chunks、真实 reindex、来源搜索引用及桌面派生 blob 外置存储已落地。 |
| Phase 5 | 已完成 | `local-hash-v1`、hybrid search、locator、真实图谱和策展接受/拒绝均已验证；Phase 6 已补齐精确撤销与统一审计。 |
| Phase 6 | 已完成 | 持久异步摄取任务、进度/取消/重试/恢复、OCR registry、统一外置审计和 SHA 冲突保护撤销已落地；真实 OCR 后端仍取决于用户配置与凭据。 |
| Phase 7 | 已完成 | 离线默认与显式 OpenAI-compatible embedding、批处理/重试/维度校验、权重配置、幂等存储迁移和 1000 页面夹具已通过。 |
| Phase 8 | 实现完成，环境验收受限 | 官方 OKF v0.1 revision、未来版本诊断、零命中 grounding 与 OOXML 自动化均已通过；Microsoft Word/Excel 外部冒烟通过，PowerPoint GUI 冒烟超时，LibreOffice 未安装。 |
| Phase 9 | 已完成 | 审阅式摘要/来源页面/合并草稿、精确接受/拒绝/撤销、hybrid MMR 评测和可过滤社区图谱已落地；生成内容默认不直写 `wiki/`。 |

## 与原始 roadmap 核实

核对基线为 `origin/main:docs/knowledge-base-roadmap.md`（`f094a21`）。原 roadmap 的顺序是“数据安全 -> 搜索和 agent 引用 -> 轻量摄取 -> 存储收敛 -> embedding/RAG -> 图谱和自动策展”，当前实现及后续计划仍保持该顺序，没有转向另一个知识库模型。

| 原 roadmap | 当前状态 | 与三项核心目标的关系 | 核实结论 |
|---|---|---|---|
| Phase 0 数据和编辑安全 | 已完成 | 是 Office 直接编辑和 OKF 安全往返的前置条件 | 二进制契约、frontmatter 源码模式和快照过滤已落地；Word/Excel 已做外部冒烟，PowerPoint/LibreOffice 保真矩阵仍是环境验证债务。 |
| Phase 1 最小搜索闭环 | 已完成 | 直接对应“智能对话调用 OKF” | UI、HTTP、desktop capabilities 已接入真实 search/read/list/tags，并保留 citation；无结果不会伪装命中。 |
| Phase 2 轻量摄取 | 基线完成 | 为对话检索来源资料提供文本层 | PDF/DOCX/XLSX/文本抽取和 manifest 已完成。原计划只要求 OCR 未配置时进入 `waiting_for_ocr`，该验收已满足；真正执行 OCR 是后续增强。 |
| Phase 3 存储收敛 | 已完成 | 保证三项能力在大量文件下仍可用 | 旧 `blobContents` 可幂等迁出并核对 SHA，外置 blob 支持重命名读取；1000 页面夹具证明正文不再线性膨胀 metadata。 |
| Phase 4 RAG v1 | 已完成 | 提升 OKF 和来源资料的语义召回 | hybrid search、locator、模型版本和离线默认已完成；真实 provider 仅在明确配置后启用，模型信息写入向量 manifest。 |
| Phase 5 图谱和自动策展 | 已完成 | 改善 OKF 知识组织，但不能越过用户审阅 | 真实图谱、自动建链、统一审计、接受后精确撤销及摘要/页面/合并 proposal 均进入审阅闭环，不静默覆盖。 |

三项核心目标中，Office 直接编辑和完整 OKF v0.1 兼容是用户要求在原 roadmap 上增加的明确产品验收；它们与原 roadmap 的数据安全、原文/笔记分离和 agent 引用原则一致，不构成方向偏离。后续不追求脱离项目现有资产、UniverJS、capabilities 和配置体系的独立知识库平台。

## Phase 6-9 实施与验证基线

以下内容保留最初实施计划的原文结构，用来核对实际实现是否偏离项目目标。2026-07-13 的完成结果和未覆盖项分别记录在“进度摘要”“变更日志”“验证记录”和“已知限制”，不能因代码已写入而删除原验收条件。

### Phase 6：摄取可靠性、OCR 和审计闭环（P0）

实施状态：已完成；真实 OCR provider 由于未配置凭据，保留为部署环境验收项。

#### 6.1 异步摄取任务

实施：

- 在 assets application 层建立摄取任务服务，controller 只负责参数校验和状态返回；复用现有 `KnowledgeIngestionService`，不复制抽取和 reindex 逻辑。
- 补齐前端已经声明的 `POST/GET wiki/ingest-jobs` 契约，任务至少包含 `queued/running/succeeded/failed/cancelled`、阶段、百分比、来源路径、创建/更新时间、失败原因和结果统计。
- 任务记录写入资产专用派生目录，不写入 `metadata.blobContents`；应用重启后把遗留 `running` 任务恢复为可重试状态。
- 支持限定来源的重建、全量 reindex、取消和失败重试；同一资产串行执行写索引任务，避免 manifest/vector index 竞争覆盖。
- KnowledgePage 展示逐任务和逐来源状态、错误详情、重试/取消操作；现有同步 `wiki/reindex` 在兼容期保留，内部改为等待同一任务服务完成。

验证：

- 单元测试覆盖状态机、非法跳转、取消、重试、同资产串行和不同资产隔离。
- controller 契约测试覆盖前端现有三条 ingest-job API，以及不存在任务、越权访问和非法 source path。
- 集成测试上传混合 TXT/PDF/DOCX/XLSX/图片，轮询到终态，核对 manifest、chunks、vector index 和统计一致。
- 中途重启 sidecar，确认遗留任务不会永远显示 `running`，重复执行仍按 SHA 复用且不产生重复派生文件。
- UI 人工验收进度、失败原因、取消、重试；大文件执行期间页面和普通知识搜索保持可响应。

#### 6.2 OCR 接入摄取管线

实施：

- 从现有 ConfigService 读取 OCR 设置，通过 `@a3s-lab/ocr` 的 `createOcrRegistry` 选择 MinerU、PaddleOCR、Unlimited OCR 或 custom backend，不在知识库模块另建 OCR 配置格式。
- 图片和无文本扫描 PDF 才进入 OCR；把原始 bytes、MIME 和文件名传给 registry，正常文本 PDF 继续走本地抽取，避免不必要的远程调用。
- OCR 文本、页码/block locator、backend/model 和执行时间写入派生索引；原始文件保持不变，搜索 citation 仍指向 `raw/sources/`。
- 区分“未配置”“暂时失败”“永久不支持”，分别保持 `waiting_for_ocr`、`error/retryable`、`unsupported`；记录可展示但不泄露 API key 的错误。
- 支持 backend、语言/模型和超时配置；任务取消通过 `AbortSignal` 传递到 OCR 请求。

验证：

- 使用 mock OCR backend 覆盖图片成功、扫描 PDF 成功、空结果、超时、限流、鉴权失败、取消和重试。
- 关闭 OCR 配置时继续满足原 roadmap：状态必须是 `waiting_for_ocr`，不得写空 chunk 或显示已索引。
- 使用至少一套真实后端做可选集成测试，验证中文、英文、多页 PDF 和表格/段落 locator；没有凭据时明确记录未覆盖项，不用 mock 结果冒充真实验收。
- OCR 后搜索原文句子，验证 agent citation 能定位到原文件和页码；重新 OCR 后旧派生内容被清理。

#### 6.3 统一审计和策展撤销

实施：

- 建立统一 `KnowledgeAuditService`，补齐已声明的 `wiki/audit-log`，覆盖页面保存/删除/重命名、来源上传/删除、摄取完成/失败、OKF 导入、配置修改和策展决策。
- 审计项统一使用 id、action、target/fromTarget、actor、timestamp、asset commit、metadata；采用有上限的外置追加记录，不能继续扩大资产 metadata。
- 接受策展建议时记录修改前后 blob SHA、commit SHA 和精确 patch。撤销仅回退该建议引入的变更；文件之后有用户编辑时返回冲突和 diff，不删除同名但由用户手工添加的链接。
- 扩展 suggestion 状态和 UI，提供撤销、撤销结果和审计详情；拒绝和撤销都不得静默改写其他页面内容。

验证：

- 单元测试覆盖所有 audit action、顺序、分页/limit、actor fallback 和敏感字段过滤。
- 策展测试覆盖接受后撤销、重复撤销、接受后用户继续编辑产生冲突，以及两个相同链接来源不同的情况。
- API/UI 验收从上传来源到摄取、编辑 OKF、接受并撤销建议，审计流顺序完整且每项可定位到目标和 commit。
- 回归确认无审阅操作不会修改 `wiki/`，自动内容仍不能绕过 review queue。

### Phase 7：真实 embedding 和存储规模化（P1）

实施状态：已完成；外部 embedding provider 通过 mock 合约验证，真实模型质量基线需在提供凭据和业务评测集后记录。

#### 7.1 可配置 embedding provider

实施：

- 把 embedding 接口从 `local-hash-v1` 具体实现中解耦，保留它作为离线默认和无配置回退；provider/model 复用项目现有配置体系和 `embeddingModel` 字段。
- 第一批支持 OpenAI-compatible provider 和一个项目已有条件允许的本地 provider；实现批处理、超时、有限重试、维度校验和错误降级。
- manifest/vector index 记录 provider、model、dimensions、版本和生成时间。模型或维度变化时构建新索引，完整成功后原子切换，失败时继续使用旧索引。
- 配置 UI 明确显示是否会向外部 provider 发送来源文本；不记录 API key 和完整请求正文。

验证：

- adapter 合约测试对本地和 mock OpenAI-compatible provider 使用同一组输入，覆盖批处理、限流重试、维度异常、超时和部分失败。
- 模型切换测试确认重新生成所有向量、清理旧模型索引且 citation/locator 不变；重建失败时旧索引仍可搜索。
- 建立中英文最小检索评测集，分别记录关键词、`local-hash-v1` 和真实 embedding 的 Top-K 命中；没有量化提升不得默认切换线上配置。
- agent 回答继续强制引用，不允许因为启用语义检索而返回无来源摘要。

#### 7.2 旧存储迁移和 1000 文件验收

实施：

- 提供幂等、可恢复的迁移命令，把旧 `metadata.blobContents` 正文迁到 asset storage/git tree，只在 SHA 核对成功后删除对应 metadata 缓存。
- 为 desktop `findCoreById` 和 pages/tree/health 建立真正轻量读取路径；metadata 只保留 path/SHA、frontmatter cache、manifest/graph summary 等小字段。
- 为缓存增加内容 SHA/版本失效规则，页面保存、重命名、删除和 OKF 导入后不会返回陈旧 health/graph。
- 迁移前生成资产快照和统计，失败可继续或按资产回退；不使用整工作区 reset。

验证：

- 构造包含旧 metadata、新外置正文和二进制来源的混合资产，连续运行两次迁移，确认幂等、SHA 一致、旧资产仍能打开。
- 建立 1000 个 Markdown 文件夹具，记录迁移前后 `assets.json` 大小、启动内存、pages/tree/health 响应体和耗时；验收重点是接口不传全文、`assets.json` 不随正文线性膨胀，并设置基于基线的回归阈值。
- 并发编辑和迁移时验证锁/版本冲突，不允许旧内容覆盖新保存内容。
- 全量回归 Office 二进制 SHA、OKF 导入导出、agent search/read 和 citation。

### Phase 8：三项核心目标的兼容性加固（P1）

实施状态：自动化实现完成；官方 OKF、grounding 和 OOXML 套件通过，外部 Office 矩阵仅 Word/Excel 通过，PowerPoint/LibreOffice 尚未满足完整环境门禁。

实施：

- Office：建立 DOCX/XLSX/PPTX 样例矩阵，覆盖普通内容、复杂排版、公式/图表、批注/修订和嵌入对象；明确“可编辑保真”“可打开但可能降级”“只读/不支持”边界。
- OKF：固定 OKF v0.1 Draft 版本和官方示例 revision，增加官方 fixture 导入、校验、导出再导入套件；为未来 OKF 版本增加显式版本诊断和迁移入口，不猜测升级。
- 智能对话：增加端到端 grounding 场景，检查工具调用顺序、personal/docs/global 权限、OKF concept 与来源 chunk 引用，以及零命中行为。

验证：

- 使用 Microsoft Office 和 LibreOffice 分别人工打开保存后的代表性 DOCX/XLSX/PPTX，并记录视觉/结构差异；无法保真的特性必须在 UI 降级提示中体现。
- OKF fixture 做 validate -> import -> edit -> export -> re-import，比较 concept、未知字段、正文和标准/相对/wikilink 链接；继续覆盖 ZIP 路径穿越、大小和文件数限制。
- 对话 E2E 记录实际 `knowledge.search` 和 `knowledge.read` 调用；有结果时引用可打开，无结果、无权限和跨 scope 时不得编造知识库依据。

### Phase 9：审阅式生成和高级检索/图谱（P2，最后实施）

实施状态：已完成；严格保持 review-only 和 citation 边界，未启用静默自动生成。

实施：

- 自动摘要、来源生成 OKF 页面、概念抽取和重复页面合并只生成带来源的 proposal/diff，统一进入 Phase 6 review queue；默认不启用，不直接写 `wiki/`。
- 在有评测集后再考虑 reranker、MMR、query rewrite 和关键词/向量权重配置；每一项必须证明召回或答案质量提升。
- 图谱按真实需要增加类型/标签过滤、搜索聚焦、边详情、社区发现和大图虚拟化；不引入无真实关系的装饰节点。

验证：

- proposal 接受、拒绝、撤销和冲突处理全部可审计；生成页面的每个结论可回到 OKF concept 或来源 chunk。
- 离线评测记录 recall@K、MRR、无来源回答率和延迟，和 Phase 7 基线比较；质量没有提升或明显破坏本地可用性时不发布。
- 1000 节点图谱验证交互、过滤和聚焦，边数、degree 和 backlinks 与后端解析结果一致。

## 阶段门禁和完成定义

每个后续 Phase 只能在以下条件全部满足后标记完成：

1. **目标门禁**：Office 直接编辑、OKF 往返、智能对话调用 OKF 三组回归全部通过；新功能没有改变 `raw/sources/`/`wiki/` 边界。
2. **安全门禁**：二进制 SHA 不变、未知 OKF 字段不丢失、权限 scope 不扩大、自动生成不静默覆盖、密钥不进入日志或索引。
3. **测试门禁**：相关 domain/application 单元测试、controller 契约测试和 web safety 测试通过；OCR/外部模型等需要凭据的真实集成测试与 mock 测试分开记录。
4. **构建门禁**：sidecar build、desktop web production build、相关 package 测试和 `git diff --check` 通过；全量 `tsc` 的既有错误与本阶段新增错误分开记录。
5. **运行门禁**：启动新构建 sidecar 做 health、目标 API 和主要 UI workflow smoke；涉及任务恢复、迁移或模型切换时必须验证失败和重启路径。
6. **记录与回退**：先更新本文档的状态、验证命令/结果、影响文件和数据迁移回退方式，再进入下一阶段；不得把历史快照中的已解决项目重新计为待办。

## 变更日志

### 2026-07-10

- 创建实施跟踪文档。
- 完成远端 roadmap 与当前代码基线核对。
- 完成 Phase 0：
  - `IAssetService` 增加 `getBlobData` / `updateBlobBinary`，返回 encoding、size、SHA、binary 标记和 MIME。
  - desktop metadata fallback 使用 `blobEncodings[path]` 区分 UTF-8 与 base64，删除和重命名同步维护。
  - 知识库来源上传直接保存原始 bytes，不再调用 `Buffer.toString('utf8')`。
  - repository blob 端点支持 base64；二进制误走文本读取时明确拒绝。
  - KnowledgePage 强制 Markdown 源码模式；文件树隐藏 `.shuan-os-snapshots`。
  - health 真实计算断链和孤立页；基础 reindex 返回真实节点、已解析链接和断链数。
- 完成 Phase 1：
  - repository tree 暴露 `isBinary`，资产文件树不再把 Office/PDF 误判为文本。
  - `workspaceApi.writeBinaryFile` 对 `asset://` 使用 base64 blob 更新并刷新树缓存。
  - 复用现有 Univer document/spreadsheet/presentation 面板完成知识库 Office 保存链路。
  - 每次保存经过 `updateBlobBinary` 生成内容 SHA 和 asset commit；后续 Phase 4 使用 SHA 判断是否重新抽取。
  - 旧版 `.doc/.ppt` 与当前不支持的 ODF 类型继续按既有 capability 显示只读/不支持，不伪装可编辑。
- 完成 Phase 2：
  - 新增纯函数 OKF v0.1 模块：YAML frontmatter、concept、diagnostic、链接解析和 bundle validation。
  - concept 强制非空 `type`；未知类型和未知 frontmatter 扩展字段保留并可被 UI/图谱读取。
  - 支持 bundle-absolute/relative Markdown links，同时保留 `[[wikilink]]`。
  - 新增 validate、目录/ZIP import、ZIP export 端点；导入先校验再写入，并限制 5000 文件/20 MB 解压正文。
  - ZIP 导入支持剥离单一顶层目录，拒绝路径穿越；导出不重新序列化 concept，确保原文和扩展字段不变。
  - KnowledgePage 增加独立的 OKF 导入/导出图标命令，与原始资料导入分开。
  - 新 scaffold 的 `wiki/index.md` 声明 `okf_version: "0.1"`；Wiki 类型契约放宽为任意字符串。
- 完成 Phase 3：
  - 新增 `KnowledgeQueryService`，统一搜索评分、snippet、citation、concept 读取、目录和标签聚合。
  - 增加 personal/docs/global scope 搜索端点及 asset 级 search/read/list/tags 端点。
  - 搜索结果包含 assetId、bundle、conceptId、path、title、type、description、resource、tags、snippet、score、citations。
  - 修复 desktop API explorer 为空导致 agent grounding 永远不可用的问题：`capabilities` 提供虚拟只读 `knowledge` 模块，直接执行 search/read/list/tags。
  - scope 解析限制为 personal/docs/global；global read 必须匹配可见全局知识资产，默认助手没有写入口。
  - runtime prompt 要求先 search、再 read、最后按 bundle/title/path/resource/citation 引用；无结果必须明确说明。
  - KnowledgePage 搜索框使用真实正文检索，不再只过滤标题和标签。
  - web agent API 保留 OKF 来源和 citation 字段。
- 完成 Phase 4：
  - 新增 `KnowledgeIngestionService`，扫描 `raw/sources/` 并建立 v1 source manifest；记录 path、MIME、SHA、size、status、抽取时间、派生路径、chunk 数和错误。
  - 实现 TXT/Markdown/CSV/JSON 等文本、PDF、DOCX、XLSX/XLS/ODS 抽取；图片与无文本 PDF 在 OCR 后端未启用时进入 `waiting_for_ocr`，未知格式进入 `unsupported`。
  - chunk 使用固定 1200 字符窗口、160 字符重叠和稳定的 SHA/index id；来源 SHA 不变时复用已有结果，来源删除或变化时回收不再引用的派生文件。
  - `wiki/reindex` 现在执行真实摄取并返回 indexed/reused/waiting/unsupported/error/chunk 统计；上传请求的 `ingest: true` 会立即执行摄取。
  - 健康度从 manifest 返回已摄取来源、OCR 等待、摄取错误和最近重建时间；知识搜索把 OKF concept 与来源 chunk 合并排序。
  - 来源搜索结果提供 `source:raw/sources/...#chunk` 可读 id、snippet 和 `asset://<assetId>/<sourcePath>` citation；knowledge.read 可读取命中的来源 chunk。
  - `.internshannon/knowledge/index/` 是逻辑派生路径；桌面端物理正文写入独立 `asset-blobs`，不再膨胀 `metadata.blobContents`。旧 metadata 和云端 Git 内容继续兼容读取。
  - 通用 blob 搜索会依据 `blobEncodings` 跳过 base64 二进制；文件树隐藏 `.internshannon` 内部目录。

### 2026-07-13

- 对照远端原始 roadmap、当前实现和用户确认的三项核心目标，固化 Phase 6-9 实施及验证计划。
- 明确 Office 直接编辑、OKF v0.1 往返和智能对话调用 OKF 是后续阶段的不可变回归门禁；OCR、embedding、图谱和自动生成只能作为增强。
- 修正 Phase 5 状态表述：建链接受/拒绝和策展审计已经完成，接受后的产品级撤销与统一知识库审计仍进入 Phase 6。
- 从 2026-07-10 暂停快照恢复，先完成类型检查、定向测试和双端构建，再继续功能修改。
- 完成 Phase 5：
  - 新增 `local-hash-v1` 离线 embedding adapter：192 维特征哈希、cosine similarity 与有限的中英文业务同义词归一化；无需联网或 API key。
  - reindex 生成独立 vector index，记录 model、dimensions、chunk hash、source path、page/line/char locator；模型路径随 model id 变化并清理旧索引。
  - `wiki/search` 合并关键词与 cosine 分；OKF concept 和来源 chunk 均支持语义命中，结果继续保留可定位 citation。
  - 增加 `wiki/similar` 与 backlinks 端点；旧 Phase 4 chunk 缺 locator 时兼容补齐，零来源库仍生成合法空向量索引。
  - GraphPane 使用确定性 force layout 绘制真实边，移除虚构 `Vault`，节点大小按 degree、颜色按 type。
  - 增加策展建议状态、刷新、配置、接受/拒绝和审计端点；reindex 仅生成建议，接受后才追加标准 OKF Markdown link，拒绝不改正文。
  - KnowledgePage 增加策展建议侧栏与图标审阅控件，刷新后保留 accepted/rejected 历史；autoCuration 关闭时 reindex 不生成新建议。
  - 修正知识库 scaffold 文案：来源进入可追溯索引，自动建议必须审阅，不再声称 LLM 会静默生成 wiki 页面。
- 完成 Phase 6：
  - 新增 `KnowledgeIngestJobService`，把摄取改为持久异步任务；提供 queued/running/succeeded/failed/cancelled、阶段和百分比，并支持取消、失败重试、重启恢复及同资产写任务串行化。
  - `KnowledgeIngestionService` 复用项目 `ConfigService` 与 `@a3s-lab/ocr` registry；图片和扫描 PDF 仅在明确配置后调用 OCR，未配置继续保持 `waiting_for_ocr`，citation 始终指向原始 `raw/sources/`。
  - 新增外置 `KnowledgeAuditService`，覆盖摄取、配置和策展决策，递归清理 apiKey/authorization 等敏感字段。
  - 策展接受记录 `appliedText`、`appliedMode`、内容 SHA 和 commit；撤销只删除该建议应用的内容，后续用户编辑会触发冲突而不是覆盖。
  - KnowledgePage 增加任务/来源进度、错误、取消/重试和统一审计视图。
- 完成 Phase 7：
  - 新增 `KnowledgeEmbeddingService`；`local-hash-v1` 保持无网络默认，外部 embedding 只有显式选择 OpenAI-compatible provider/model 时启用。
  - 外部 adapter 支持批处理、有限重试、维度校验和安全配置读取；向量 manifest 记录 provider、model、dimensions，查询和候选 concept 合并为批量调用。
  - KnowledgePage 提供关键词/向量权重、MMR lambda、provider/model/dimensions 配置，并明确外部 provider 数据发送边界。
  - `migrateKnowledgeStorage` 幂等迁出 `wiki/`、`raw/sources/` 和派生正文，SHA 核对成功后才清 metadata；外置 blob 的读取、删除和重命名同步工作。
  - 1000 页面迁移夹具验证迁移后 metadata 体积低于迁移前 1%，二次执行不重复迁移。
- 完成 Phase 8 自动化兼容加固：
  - OKF v0.1 官方 fixture 固定到 `GoogleCloudPlatform/knowledge-catalog` revision `d44368c15e38e7c92481c5992e4f9b5b421a801d`，覆盖官方 Appendix A bundle shape、扩展字段和链接。
  - 对未来 OKF version 保持 best-effort 读取并返回显式迁移诊断；不把未知版本猜成 v0.1。
  - grounding 测试覆盖真实 `knowledge.search/read` 接线、scope 限制、citation 和零命中不编造。
  - OOXML 套件覆盖 DOCX 标题/富文本/列表/表格、XLSX 公式和稀疏表、PPTX 文本修改及包保留；外部 Office 结果单独记录，不用自动化冒充人工保真。
- 完成 Phase 9：
  - 策展刷新生成摘要、来源转 OKF 页面和合并审阅草稿，全部带 citations/proposedContent；接受前不创建页面，合并草稿不删除任何来源 concept。
  - proposal 支持接受、拒绝、撤销及 SHA 冲突检测；刷新已审阅建议时保留应用正文、SHA 和模式，避免刷新后无法精确撤销。
  - 检索增加可配置 hybrid 权重与 MMR 去冗余，`wiki/evaluate` 输出 recall@K、MRR、空结果数和延迟。
  - 图谱增加 source-to-concept 边、connected-component 社区、type/tag/search 过滤、节点聚焦和边详情；前端最多渲染 120 个可见节点，避免大图无界绘制。
- 完成用户真实网页链路反馈修复：
  - Office 切换：移除浏览器端 `Buffer.from()`，DOCX 根据环境选择 Mammoth 输入；Univer 销毁延迟到 React 卸载完成后，不再使用 `replaceChildren()` 破坏 React DOM 所有权，修复 `removeChild` 非子节点错误。
  - Office 服务隔离：Docs/PPT 使用每个 Univer 实例的 `ICommandService`，不再使用跨实例 `FUniver.newAPI()`；PPT 补齐 Docs preset 依赖，解决 `univer.editor.service`/redi 注入失败和 `no document with unitId` 保存崩溃。
  - Office 编辑：收紧 dirty 判定，选区/缩略图操作不再触发保存；由于 Univer Slides 0.24 没有可用键盘文本输入，增加 PPT 文本侧栏，修改后重建 canvas 对象并持久化。
  - 搜索跳转：结果行改为可操作按钮并派发 `open-file`；TXT/CSV 新上传按 UTF-8 保存，旧 base64 文本保持兼容解码，`customer-renewal-plan.txt` 可从命中项直接打开。
  - 策展状态：排除 `wiki/generated/`/`wiki/drafts/` 和生成/审阅 tag 的递归输入；按资产串行刷新/审阅，保留已审历史并清理陈旧 pending；append 撤销只删除当时应用的精确文本，不破坏后续用户内容。
  - 检索配置：增加“恢复默认”，回填 `local` / `local-hash-v1` / 192 维 / keyword 1 / vector 6 / MMR 0.78。
- 完成智能对话真实 OKF 调用修复：
  - 根因是 Sidecar 仅把 `CapabilitiesToolService` 注册到 Nest/HTTP，SDK 会话 `toolNames` 没有该工具；同时 Web 把不存在的 `capabilities` 当作 skill 声明，模型因而调用 `Skill(capabilities)` 并失败。
  - 新增 Sidecar 本机无状态 MCP 端点 `POST /api/v1/kernel/mcp`，会话启用 capabilities 时自动注册 `mcp__internshannon__capabilities`、`knowledge_search`、`knowledge_read`；协议返回绕过标准 API envelope，GET 探测按 MCP 规范返回 405。
  - Web 桌面端不再把产品元数据或无 `SKILL.md` 的默认名称冒充为已安装 skill；云端 progressive API skill 语义保持不变。
  - 由于模型可能把知识检索委派给不继承动态 MCP 的子任务，对明确“我的/个人知识库”问题在父会话执行确定性 search/read grounding；检索前去除“请搜索…是什么/给出引用”等指令词，保留真实实体查询。取回内容作为不可信参考数据注入，不执行其内指令。
  - 默认模型不生效的根因是 `CONFIG_SERVICE` 用 `useClass` 与直接 `ConfigServiceImpl` provider 创建了两个独立缓存实例；控制器已显示新值，运行时仍读旧 zhipu 快照。改为 `useExisting` 共享单例，配置同步与运行时解析一致。

## 验证记录

### Phase 0

- `node apps/sidecar/scripts/build-desktop-sidecar.mjs`：通过，284 files。
- `apps/sidecar/node_modules/.bin/jest --runInBand src/modules/assets/presentation/controllers/desktop-assets.controller.spec.ts`：通过，3 tests。
- `node --test apps/web/src/components/workspace/file-tree-editor/knowledge-editor-safety.spec.mjs`：通过，2 tests。
- `PATH="$PWD/node_modules/.bin:$PATH" node scripts/build-desktop.mjs`（`apps/web`）：通过。
- 全 sidecar `tsc --noEmit` 仍有建档前既有错误：desktop runtime config 测试的 `AppSettings` 强转、`shared/index.ts` 缺失导出目标及 `Result` 重复导出；本次涉及文件没有新增诊断。
- 当前 Corepack pnpm 11 与本机 Node 20.9 的动态导入不兼容，因此使用仓库本地二进制和构建脚本完成验证。

### Phase 1

- sidecar build：通过。
- desktop assets controller：通过，4 tests（新增 base64 Office 更新契约）。
- knowledge editor safety：通过，3 tests（新增 `asset://` 二进制写入契约）。
- `packages/ooxml` Jest：通过，9 tests，覆盖 DOCX、XLSX 和 PPTX 导入/导出往返。
- desktop web production build：通过。
- Phase 1 当时尚未进行外部 Microsoft Office/LibreOffice 打开测试；2026-07-13 最终回归已补 Word/Excel 基础冒烟，PowerPoint/LibreOffice 结果及复杂特性边界见 Phase 6-9 验证记录和“已知限制”。

### Phase 2

- sidecar build：通过，285 files。
- OKF + desktop assets Jest：通过，10 tests。
- 覆盖：frontmatter/扩展字段、必填 type、未知 type、路径安全、相对/绝对链接、ZIP 导入导出原文往返、标准链接图谱。
- knowledge editor safety：通过，4 tests，包含 OKF UI 命令。
- desktop web production build：通过。

### Phase 3

- sidecar 定向 Jest：通过，4 suites / 21 tests。
- 覆盖：关键词权重、正文 snippet、外部 citation、concept 原文、目录/标签、capabilities 虚拟模块 search/read、运行时 grounding prompt。
- knowledge editor safety：通过，5 tests，包含真实 `wikiSearch` 接线。
- sidecar build：通过，286 files。
- desktop web production build：通过。

### Phase 4

- sidecar 定向 Jest：通过，5 suites / 24 passed / 1 skipped；覆盖 TXT/DOCX/XLSX 抽取、确定性 chunk、SHA 复用、OCR 等待、陈旧派生清理、外置 blob、来源搜索/read/citation、OKF 和 agent grounding 回归。
- PDF.js 真实文本抽取：`NODE_OPTIONS=--experimental-vm-modules ...jest -t 'extracts text from a PDF'` 通过；常规 Jest 29 不支持其 ESM worker，因此该单项在普通套件中跳过。
- sidecar build：通过，287 files。
- knowledge editor safety：通过，5 tests，包含 `.internshannon` 隐藏契约。
- 全 sidecar `tsc --noEmit`：本次 Phase 4 文件无诊断；仍仅有建档前 runtime config spec 与 shared barrel 的 8 个既有错误。

### Phase 5

- sidecar 定向 Jest：通过，6 suites / 28 passed / 1 skipped；覆盖 embedding 稳定性与同义归一、vector index、locator、旧 chunk、空索引、hybrid source search、OKF similar、策展接受/拒绝/审计及 Phase 0-4 回归。
- PDF.js 专项：通过，1 test；Jest 29 运行时仍会输出 PDF.js canvas polyfill warning，但文本抽取结果正确。
- `packages/ooxml` Jest：通过，9 tests。
- knowledge editor safety：通过，7 tests；覆盖 frontmatter、Office base64、OKF 命令、真实搜索、force graph、无 Vault 和策展审阅控件。
- sidecar build：通过，288 files。
- desktop web production build：通过。
- 运行时 smoke：新构建 sidecar 在 `127.0.0.1:29753` 启动，`/api/v1/health` 与 `wiki/curation/suggestions` 均返回 200；desktop web dev preview 在 `127.0.0.1:4173` 启动并指向该 sidecar。
- 全 sidecar `tsc --noEmit`：Phase 5 文件无诊断；仍仅有建档前 runtime config spec 与 shared barrel 的 8 个既有错误。
- `git diff --check`：通过。

### 网页人工验收包（2026-07-13）

- 新增 `知识库测试/Phase5-9网页测试/`：包含 5 个可增量导入的 OKF concept、TXT/CSV/PNG 来源以及 DOCX/XLSX/PPTX 直接编辑夹具。
- `okf-demo-incremental.zip` 已用当前 OKF validator 校验：5 concepts、0 errors、1 个预期的 implicit-version warning；导入默认个人库后由既有 `wiki/index.md` 声明 OKF 0.1，避免根页面冲突。
- Office 夹具结构已核对：DOCX/PPTX 含 `BQ-7429`；XLSX 含 `NRR-2026`、数值 108 和 `SUM(B2:B2)` 公式。
- `README.md` 固化 14 步网页验收顺序，覆盖 OKF、正文检索、图谱/反链、异步摄取、OCR 等待、Office 保存、citation、策展撤销/冲突、检索配置、存储迁移、导出防覆盖和智能对话零命中。

### Phase 6-9（2026-07-13 最终回归）

- sidecar 定向 Jest：通过，8 suites / 42 passed / 1 skipped。覆盖 embedding provider、OCR mock、异步任务/审计、1000 页面迁移、官方 OKF revision、未来版本诊断、hybrid MMR 评测、零命中 grounding、图谱社区/过滤和策展 proposal 精确撤销。
- 补充回归：“接受建议 -> 刷新建议 -> 撤销”会保留 `appliedText`、`appliedContentSha`、`appliedMode`，并恢复接受前原文。
- sidecar build：`node scripts/build-desktop-sidecar.mjs` 通过，291 files。
- knowledge editor safety：`node --test src/components/workspace/file-tree-editor/knowledge-editor-safety.spec.mjs` 通过，9 tests。
- desktop web production build：`PATH="$PWD/node_modules/.bin:$PATH" node scripts/build-desktop.mjs` 通过。
- `packages/ooxml` Jest：通过，9 tests；覆盖 DOCX、XLSX、PPTX 自动化往返。
- 运行时 smoke：新构建 sidecar 使用隔离数据目录启动于 `127.0.0.1:29663`，health 200；OpenAPI 暴露 32 条 knowledge/wiki 路由。OKF validate、零命中 hybrid-MMR search、embedding config、ingest jobs、audit log、graph 和 reindex 均返回预期契约。新 web preview 在 `127.0.0.1:4183` 启动，根路由及 `/knowledge` 深链均返回 200 和应用 shell。
- Microsoft Office 外部 smoke：Word 打开 DOCX 并读取标题、富斜体正文和表格；Excel 打开 XLSX 并读取 `Knowledge`、`42` 和公式结果。PowerPoint 打开临时 PPTX 时 AppleEvent 超时，未标记通过；LibreOffice 未安装，未执行。
- 真实 OCR 和真实外部 embedding：当前没有配置后端凭据，只通过 mock adapter 合约和错误/回退路径；不能声称真实 provider 已验收。
- 全 sidecar `tsc --noEmit`：仍只有建档前 8 个错误，即 5 个 `AppSettings` 测试强转、两个缺失 barrel 目标和一个重复 `Result` 导出；本阶段文件没有新增诊断。
- `git diff --check`：通过。

### 用户反馈真实链路回归（2026-07-13）

- 进程：仅重启主 Sidecar `127.0.0.1:29653`，Web `127.0.0.1:5000`、旧隔离 Sidecar `29663` 和其他进程保留；没有通过“全部杀掉”规避根因。
- Office 真实浏览器：DOCX/XLSX/PPTX 连续切换无 `Buffer is not defined`、Univer service 缺失、`removeChild` 或 `no document with unitId`；DOCX 实际输入/保存/重开通过，PPT 侧栏文本修改/保存/重开通过并恢复测试内容。
- 搜索/UI：“客户沟通检查点”命中 `raw/sources/customer-renewal-plan.txt`，点击后文本预览正常；恢复默认显示 `local / local-hash-v1 / 192`。
- 策展：真实主数据刷新得到 16 个 link/summary/page/merge pending，递归 managed-page 输入为 0；来源页 proposal 接受后 citation 存在，撤销后页面删除且内容恢复正确。
- MCP SDK：真实 `@a3s-lab/code` 会话从主 Sidecar 注册 3 个工具；直接 `knowledge_search(scope=personal, query=蓝鹊校验码)` 返回 `BQ-7429`、TXT `asset://` citation 和 OKF concept。
- WebSocket 正例：在 `http://127.0.0.1:5000/#/` 新会话选择 `boyue/gpt-5`，输入“请先搜索我的个人知识库：蓝鹊校验码是什么？给出具体文件引用。”，回答 `BQ-7429`，引用 `raw/sources/customer-renewal-plan.txt`、完整 `asset://...` 和 `wiki/concepts/revenue-plan.md`。
- WebSocket 负例：同会话询问 `MARS-0000`，回答明确“未命中”且 `search.hits` 为空，没有伪造 citation；两轮浏览器 `pageerror`/console error 均为 0。
- 自动化：sidecar 知识/运行时聚焦 Jest `9 suites / 78 passed / 1 skipped`；新 grounding 单测覆盖 search -> read 顺序、引用和问句归一化；sidecar build 与 `tsconfig.build.json --noEmit` 通过，web production build 通过，knowledge editor safety 13 项通过。
- 模型配置：原全局 default `zhipu111/glm-5.2` 真实调用返回 `empty_response`；`boyue/gpt-5` 已在本链路完成正反例。通过类型化 `PATCH /api/v1/config` 仅将 `llm.defaultModel` 改为 `boyue/gpt-5`，provider、密钥和其他 AI 参数未改动；修复配置单例后，新建 `followDefaultModel=true` 会话成功返回文本，无 `empty_response`/缺 key 错误。

### 第二轮网页反馈改进（2026-07-14）

- 个人库产品边界：保持“每用户唯一专属知识库”，不引入会破坏默认对话 scope、权限和单例约束的多个人库。该约束保留在产品模型和测试说明中；界面名称和简介经后续用户反馈恢复原“书小安知识库”展示。
- 摄取取消语义：仅 `queued/running` 可取消；`succeeded` 是已持久化的终态，不增加会混淆“删除来源 / 回退索引 / 撤销任务”的撤销按钮。新增两份约 2 MiB 的 `queued-ingest-a.txt` / `queued-ingest-b.txt`，连续分别导入时使第二个任务真实进入同资产串行队列。
- 策展撤销：append 和 create 现在统一核对接受后内容 SHA；页面有任何后续编辑时返回 `409`，不自动删除片段。撤销后刷新时，仍有效的 proposal 恢复为 `pending`，过期的 reverted 项从活动列表移除，独立 `curation.reverted` 审计记录保留。
- 图谱交互：type/tag/搜索过滤从“只显示严格命中”改为“命中节点 + 一跳邻居”，上下文节点降低视觉强度。右侧关系卡保持原纵向外观和布局，但可点击高亮起点、终点和唯一方向连线；方向语义由图中箭头承担，不在卡片内重复改造布局。
- OCR：按用户决定继续标记为“真实 provider 待验收”，本轮未配置凭据、未修改 OCR 默认行为。
- 定向验证：策展/任务 Jest `19 passed`，knowledge editor safety `13 passed`，Sidecar `tsconfig.build.json --noEmit`、Sidecar build（294 files）和 Web production build 通过。
- 真实主数据策展刷新：刷新后活动列表为 12 `pending` + 3 `accepted` + 0 `reverted`，待审类型为 4 link / 5 summary / 2 page / 1 merge。
- 真实 SHA 冲突：已接受建议 `b476ae63...` 的当前页面 SHA 与 `appliedContentSha` 不同；撤销请求返回 HTTP `409`，建议仍为 `accepted`，页面未改写。
- 真实 Edge 图谱：在 `http://127.0.0.1:5000/#/knowledge` 选择 `Metric` 后显示续费率指标及 3 个一跳邻居；点击关系卡后 1 条线高亮、2 个端点高亮，浏览器 console/pageerror 为 0。

### 第三轮网页反馈改进（2026-07-14）

- 上传与摄取解耦：不再用全局 `busy` 锁住“导入资料”。选择文件后立即在“任务与审计”显示 reading/uploading/starting 卡片并自动打开该面板；其他文件可继续导入。每个文件使用后端原子“上传 + 入队”，避免页面关闭时留下无任务的 pending 来源。
- 摄取阻塞根因：旧 locator 为每个 chunk 从全文开头重数行/页，大文本形成近似 O(n²) 同步阻塞。改为一次扫描换行/分页位置 + 二分定位；分块和本地 embedding 分批让出事件循环，使状态轮询和取消请求在处理期间可达。
- 取消竞态：运行任务收到取消后先显示 `cancelling`并禁用重复点击。如请求到达时任务已终态，幂等返回最新状态，不执行任何索引回退。单来源任务卡显示具体文件名，避免同时任务无法区分。
- 库概览导航：新增 `open-file-preserve-sidebar` 命令。库概览中点击页面会在主编辑区打开文件，但保留库概览侧栏；资源管理器不被强制选中。
- 策展与打开文件：审阅成功后刷新文件树，并向已打开的受影响文件发送 `reload-file`。干净编辑器重读后端内容；如该文件有 dirty/saving/error 状态，审阅前直接阻止并提示先保存，不允许覆盖未保存内容。
- UI 取舍：知识库名称和动态简介恢复原展示；关系卡恢复原三行纵向外观，保留点击高亮，起终方向仅由图中箭头表达。
- 自动验证：knowledge ingestion/embedding/operations/controller 定向 Jest 累计 `25 passed / 1 skipped`，包含真实大文本 `running + queued` 双取消回归；knowledge editor safety `15 passed`；Sidecar `tsconfig.build.json --noEmit`、Sidecar build（294 files）和 Web production build 通过。
- 真实 Edge：上传选择后立即显示阶段卡、自动打开任务面板且导入按钮仍可用；真实观察到 `running` 与 `queued` 及取消控件。库概览打开页面后 `overview=true/explorer=false`。关系卡保持原布局，点击后 1 条线与 2 个端点高亮，10 条可见线均有箭头，console/pageerror 为 0。
- 真实策展打开文件：在文件已打开时接受并撤销 summary，编辑器标签全程保留、策展侧栏全程保持选中，API 内容在接受后增加并在撤销后精确恢复，console/pageerror 为 0。无头 Edge 无法通过 DOM 读取 Monaco 屏幕外行，不将该限制伪装为可视行断言。
- 测试清理：本轮上传的 `internshannon-live-*` 临时来源已全部删除并完成全量重建；用户已有的 `queued-ingest-a/b.txt` 夹具和其他资料未删除。

## 历史暂停快照

- 暂停日期：2026-07-10，下班前主动暂停。
- 最近可靠基线：Phase 4 已完成并通过定向 Jest、sidecar build、PDF 专项与 web safety 测试；对应记录见上节。
- 工作区未提交，不能用 `git reset` 或整目录覆盖回退；`scripts/predeploy-check.sh`、`scripts/predeploy-check.spec.mjs`、`SKILL.md`、`知识库测试/` 仍是实施前用户改动，继续保护。
- 暂停前只完成了 Phase 5 代码写入，尚未执行任何 Phase 5 编译、类型检查或测试。当前 `git diff --check` 通过，仅表示补丁没有空白错误。

### Phase 5 已写入但未验证

- 新增 `domain/knowledge/local-embedding.ts`：`local-hash-v1` 离线特征哈希、cosine similarity 和中英文常用业务同义词归一化。
- `KnowledgeIngestionService` 草稿已增加 vector index、embedding model、chunk page/line/char locator，并尝试把向量文件写入派生索引目录。
- `KnowledgeQueryService` 草稿已增加关键词 + cosine 合并评分和 `wiki/similar`。
- `KnowledgePage.GraphPane` 草稿已移除中心 `Vault`，增加真实边、按 degree 调整节点尺寸、按 type 着色和确定性 force layout。
- `DesktopAssetsController` 草稿已增加策展状态、建议刷新、接受/拒绝和审计接口；接受建议后才会追加 OKF Markdown link。

### 暂停时未完成（已于 2026-07-13 解决）

- Phase 5 代码可能仍有 TypeScript、Nest 路由/注入或 JSX 编译错误，恢复后必须先验证，不能继续叠加功能。
- 尚未为 local embedding、vector index、hybrid 同义检索、`wiki/similar`、策展接受/拒绝补测试。
- 前端尚未增加策展建议列表及接受/拒绝操作，也未在 `assetsApi` 增加对应 suggestion API。
- 尚未确认 reindex 在“零来源”“旧 manifest 无 locator”“embedding 模型变化”三种情况下的兼容行为。
- 尚未更新 Phase 5 验收勾选、验证记录和回退文件；以上内容全部保持未完成状态。

恢复结论：上述 Phase 5 未完成项均已实现并验证，当前结论以“2026-07-13”变更日志和 Phase 5 验证记录为准。

### 历史恢复顺序（已完成）

1. 先运行 sidecar `tsc --noEmit` 和定向 Jest，修复所有指向 Phase 5 文件的新诊断；既有 8 个基线错误仍按前文区分。
2. 运行 `node scripts/build-desktop-sidecar.mjs` 与 web desktop production build，优先检查 `KnowledgePage.tsx` JSX 和 controller Nest 路由。
3. 为 embedding/vector/hybrid/similar/curation 增加单元测试；验证同义查询能命中且引用仍定位到 source chunk。
4. 接入前端策展审阅列表、接受/拒绝按钮，再做 UI 构建与人工流程验证。
5. 全部通过后才更新 Phase 5 勾选和进度摘要，并补充回退文件范围。

当时建议的恢复命令（现已执行并由 Phase 6-9 最终回归替代）：

```bash
cd /Users/caozichen/Downloads/书小安/InternShannon/apps/sidecar
./node_modules/.bin/tsc --noEmit --pretty false
./node_modules/.bin/jest --runInBand \
  src/modules/assets/application/knowledge-ingestion.service.spec.ts \
  src/modules/assets/application/knowledge-query.service.spec.ts \
  src/modules/assets/domain/knowledge/open-knowledge-format.spec.ts \
  src/modules/assets/presentation/controllers/desktop-assets.controller.spec.ts \
  src/modules/kernel/application/kernel-runtime-config.builder.spec.ts
node scripts/build-desktop-sidecar.mjs
```

## 回退说明

- 本文件创建前没有知识库代码改动。
- 每一阶段应保持文件范围和测试范围清晰；需要回退时按“变更日志”中记录的文件逐项处理，不使用破坏性工作区重置。
- Phase 0 回退文件：`asset.service.interface.ts`、`asset-git-repository.service.interface.ts`、`asset.service.ts`、`desktop-assets.controller.ts`、`KnowledgePage.tsx`、`FileTreeEditor.tsx` 及两份新增测试。
- Phase 1 回退文件：`desktop-assets.controller.ts`、`assets.ts`、`workspace-api.ts` 及 Phase 0/1 共用测试。
- Phase 2 回退文件：`open-knowledge-format.ts` 及其测试、`desktop-assets.controller.ts`、`asset.service.ts`、`assets.ts`、`KnowledgePage.tsx` 和相关测试。
- Phase 3 回退文件：`knowledge-query.service.ts` 及测试、`desktop-assets-runtime.module.ts`、`desktop-assets.controller.ts`、`capabilities-tool.service.ts`、`kernel-runtime-config.builder.ts`、web `assets.ts`/`agent-api.ts`/`KnowledgePage.tsx` 及相关测试。
- Phase 4 回退文件：`knowledge-ingestion.service.ts` 及测试、`knowledge-query.service.ts`、`desktop-assets.controller.ts`、`asset.service.ts`、`asset.repository.interface.ts`、`desktop-asset.repository.ts`、`desktop-assets-runtime.module.ts`、web `assets.ts`/`FileTreeEditor.tsx` 及相关测试。桌面物理派生文件位于数据目录 `asset-blobs/`，删除资产会同步清理。
- Phase 5 回退文件：`local-embedding.ts` 及测试、`knowledge-ingestion.service.ts`、`knowledge-query.service.ts` 及测试、`desktop-assets.controller.ts` 及测试、web `assets.ts`/`KnowledgePage.tsx`/knowledge editor safety test。
- Phase 6 回退文件：`knowledge-audit.service.ts`、`knowledge-ingest-job.service.ts`、`knowledge-operations.service.spec.ts`、`knowledge-ingestion.service.ts`、`desktop-assets.controller.ts`、`desktop-assets-runtime.module.ts`、web `assets.ts`/`KnowledgePage.tsx`。任务和审计位于外置 asset storage；回退代码前先保留对应派生文件，不删除用户 `wiki/` 或 `raw/sources/`。
- Phase 7 回退文件：`knowledge-embedding.service.ts` 及测试、`knowledge-ingestion.service.ts`、`knowledge-query.service.ts`、`asset.service.ts`、repository/service interfaces、`desktop-asset.repository.ts`、runtime module、web `assets.ts`/`KnowledgePage.tsx`。存储迁移不可用工作区 reset 逆转；需要按迁移统计把已核对 SHA 的外置正文逐资产恢复到兼容存储。
- Phase 8 回退文件：`open-knowledge-format.ts` 及测试、controller/capabilities/runtime config grounding 测试、OOXML 既有套件相关断言和 web safety test。官方 fixture revision 是测试基线，不应随意改成未经核对的最新版。
- Phase 9 回退文件：`knowledge-query.service.ts` 及测试、`desktop-assets.controller.ts` 及测试、web `assets.ts`/`KnowledgePage.tsx`/knowledge safety test。撤销高级 proposal 代码不等于删除已由用户接受的页面；对已接受内容只能继续使用带 SHA 的产品级撤销。
- 真实网页缺陷回退文件：Office 部分为 web `FileTreeEditor.tsx`/`univer-*-panel.tsx`/`univer-runtime-lifecycle.ts` 与 `packages/ooxml/src/docx/*`；搜索/策展/默认配置为 `KnowledgePage.tsx`、`assets.ts`、controller 及 knowledge services；对话 OKF 部分为 `capabilities-mcp.service.ts`、`kernel-capabilities-mcp.controller.ts`、runtime factory/config/runner 及 web `agent-runtime-config.ts`。回退对话适配时不得删除用户 `wiki/`、`raw/sources/` 或外置索引。

## 已知限制

- `local-hash-v1` 是无配置时的离线默认，不等同于神经网络 embedding；OpenAI-compatible provider 已可配置，但本次没有真实凭据，只完成 mock adapter 合约验证。
- OCR 后端未配置时，图片和扫描 PDF 会保持 `waiting_for_ocr`，不会伪装成已索引。
- Office 复杂排版、批注、修订、嵌入对象和图表仍受现有 Univer/OOXML adapter 保真范围限制；Microsoft Word/Excel 基础外部打开已通过，PowerPoint 自动化超时，LibreOffice 未安装，因此完整外部保真矩阵仍未完成。
- 自动摘要、来源页面和合并草稿已经实现为手动刷新产生的 proposal，默认不主动运行；只有用户接受后才写入，且任何后续实现仍不得绕过审阅覆盖 `wiki/`。
- 1000 页面迁移夹具已通过，但尚未完成 1000 真实关系节点的浏览器交互性能录制；当前前端以过滤和最多 120 个可见节点控制渲染规模。
- 全量 sidecar TypeScript 仍有 8 个实施前基线错误；构建和知识库定向测试通过不代表这些仓库级技术债已解决。
- 原全局默认模型 `zhipu111/glm-5.2` 在真实调用中返回空响应；已切换为通过真实正反例的 `boyue/gpt-5`。若用户之后切回 zhipu provider，需先单独验证该 provider/model 的非空 stream 兼容性。
