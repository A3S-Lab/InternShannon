# Knowledge Base Roadmap

本文档基于 `知识库评估报告.md` 以及对当前代码的复核，给出修订后的知识库优化计划。目标不是直接追完整 RAG，而是先把本地知识库做成可靠、可检索、可被 agent 引用的产品闭环。

## 结论摘要

当前知识库的方向是对的：它已经以 Digital Asset 为核心，拥有个人知识库、全局知识库、文件管理、wiki 页面、wikilink 图谱雏形和 agent 侧接入意图。但实现状态仍停在早期阶段：上传、存储、搜索、健康度、图谱、agent grounding 之间没有形成可信闭环。

最高性价比路线是：

1. 先保护数据不被损坏。
2. 再让用户和 agent 能搜到内容。
3. 然后做轻量摄取和 chunk manifest。
4. 最后再上 embedding、向量检索、自动策展和更复杂图谱。

## 已确认的问题

### P0: 二进制上传会损坏

`apps/sidecar/src/modules/assets/presentation/controllers/desktop-assets.controller.ts` 的 `uploadWikiSources` 会把 base64 解成 `Buffer` 后用 `toString('utf8')` 写入。PDF、图片、Office 等二进制文件会被破坏。

更深层的问题是资产写入接口仍以 `content: string` 为中心：`IAssetService.updateBlob` 和 git repository 的 `commitFile` 都偏文本语义。修复不能只改 controller，需要明确二进制读写契约。

### P0: metadata 存全文会拖垮本地资产

desktop fallback 会把文件正文写入 `asset.metadata.blobContents`。这在少量 Markdown 文件下可用，但会让本地 `assets.json` 变大，并让列表、搜索、健康度计算、资产分页都承担全文 JSON 读写成本。

注意：当前 desktop 路径没有 Postgres，因此报告里的 jsonb 上限判断不适用。但 local-first 并不意味着可以无限把全文塞进 metadata，本地文件同样会出现启动慢、保存慢、内存涨、接口响应慢。

### P0: agent grounding 提示词和真实能力不一致

默认 assistant 的 runtime prompt 要求使用 `capabilities` 搜个人知识库，但 `capabilities.search` 实际只搜索 API operation 元数据，不能搜索 wiki 内容。这会让 agent 以为自己已经接入知识库，实际只能找到接口说明。

### P1: 知识库搜索契约有前端声明，后端缺实现

`apps/web/src/lib/api/assets.ts` 已声明 `wikiSearch`、`wikiSimilar`、`wikiTags`、`wikiStartIngest`、`wikiAuditLog` 等接口，但 desktop assets controller 只实现了 sources、pages、graph、health、reindex 的一小部分。

这说明产品契约已经预留，最划算的下一步是先补最小可用后端，而不是重新设计大系统。

### P1: 健康度指标失真

`brokenLinks` 固定为空数组，`orphanPages` 基本等于所有非 `wiki/index.md` 页面。用户看到的健康度数字不可信，会误导后续维护。

### P1: Markdown WYSIWYG 可能破坏 frontmatter

知识库页面通过 `AssetFileManager` 打开 Markdown，而 `AssetFileManager` 当前强制 `enableRichMarkdown={true}`。TipTap Markdown 序列化对 YAML frontmatter 不安全时，知识库元数据会被破坏。

### P2: 图谱 UI 只是视觉雏形

后端能根据 wikilink 生成 edge，但前端 `GraphPane` 只画节点和中心 `Vault`，没有画边，也没有按 type、degree 或社区结构表达图谱语义。

## 修订后的产品原则

- 原文素材和用户笔记分离：`raw/sources/` 保存来源文件，`wiki/` 保存用户可编辑笔记。
- metadata 保存索引和缓存，不保存大体积全文。
- 第一版检索先做关键词和引用片段，embedding 是第二阶段。
- 自动摘要和自动建链必须可追溯、可撤销，不应在用户不知情时覆盖手写 wiki。
- agent 回答必须引用来源 path/title/snippet，找不到时要明确说找不到。

## 分阶段计划

### Phase 0: 数据安全和编辑安全

目标：阻止知识库继续产生不可恢复的数据损坏。

任务：

- 为知识库上传增加二进制安全策略。短期可以拒绝 PDF、图片、Office 等二进制来源，或新增 `updateBlobBinary`/`getBlobBytes` 一类接口。
- 调整 asset blob 读写模型，至少让 `Blob.isBinary`、`contentSha`、`size` 和原始 bytes 一致。
- 知识库页面默认关闭富文本 Markdown，或让 `AssetFileManager` 暴露 `enableRichMarkdown` 并由 KnowledgePage 关闭。
- 文件树过滤 `.shuan-os-snapshots`，避免 fallback 快照目录出现在用户文件树里。

验收：

- 上传 PDF 后，读取出的 bytes hash 与原文件一致，或产品明确拒绝上传并给出提示。
- 新建/编辑 `wiki/index.md` 后 frontmatter 仍是合法 YAML。
- 用户文件树不展示 `.shuan-os-snapshots`。

### Phase 1: 最小可用搜索闭环

目标：让知识库真正可搜索，并让 agent 可以基于结果回答。

任务：

- 实现 `GET /api/assets/:id/wiki/search`。第一版可复用 `assetService.searchBlobs`，限制在 `wiki/**/*.md` 和已抽取文本。
- 返回 `query`、`hits[]`，每个 hit 包含 `path`、`title`、`type`、`score`、`snippet`。
- 在 `CapabilitiesToolService` 或 API operation 层暴露只读知识库搜索能力，修复默认 assistant prompt 和真实能力不一致。
- 修复 `wiki/health`：真实计算 broken links、orphan pages、tagged pages。
- 实现 `wiki/tags`，先从 frontmatter 聚合即可。

验收：

- 在知识库 UI 中搜索某个 wiki 页面正文关键词，可以返回包含片段的结果。
- 默认 assistant 被问到个人知识库内容时，会先检索并引用 path/title。
- 含 `[[不存在页面]]` 的页面会出现在 broken links。
- 只有入度为 0 且不是入口/说明类页面的内容页会被算作 orphan。

### Phase 2: 轻量摄取 v1

目标：让来源文档进入可检索文本层，但不急着自动生成 wiki 摘要。

任务：

- 为 `raw/sources/` 建立 source manifest：原始路径、mime/ext、sha、size、extractedTextPath、chunk count、lastExtractedAt。
- 使用现有依赖做文本抽取：
  - PDF: `pdf-parse`。
  - DOCX: `@a3s-lab/ooxml` 中已有 mammoth 能力。
  - XLSX/CSV: `xlsx` 或 `@a3s-lab/ooxml`。
  - 图片和扫描 PDF: 只在 OCR 配置可用时进入 OCR，否则标记为 waiting_for_ocr。
- 抽取结果写入派生目录，例如 `.internshannon/knowledge/index/` 或 asset 专用索引目录，而不是塞入 `metadata.blobContents`。
- `wiki/reindex` 真正触发重建：扫描 sources/wiki、刷新 manifest、更新 health。

验收：

- 上传可解析 PDF 后，搜索原文中的一句话可以命中。
- 修改来源文件后，sha 变化会触发重新抽取。
- OCR 未配置时，扫描件不会伪装成已索引。

### Phase 3: 存储模型收敛

目标：把正文从 metadata 中逐步迁出，让知识库能承载大量文件。

任务：

- metadata 只保留轻量索引：`path -> contentSha`、frontmatter cache、source manifest summary、graph summary。
- 正文按需从 git tree 或本地 asset storage 读取。
- 为旧 `blobContents` 提供迁移或兼容读取：旧资产可以继续打开，但新写入不再扩大全文 metadata。
- 避免列表接口序列化全文。`findCoreById` 在 desktop 也应有轻量路径，而不是总是读取完整资产。

验收：

- 1000 个小 Markdown 文件下，pages/tree/health 接口不需要传输所有全文。
- `assets.json` 不随来源正文线性膨胀。
- 旧资产仍可读，新资产走新模型。

### Phase 4: RAG v1

目标：在文本抽取和引用片段可靠后，引入语义检索。

任务：

- 增加 embedding adapter，模型配置复用现有配置体系。
- 建立本地向量索引，优先考虑简单可维护的文件索引或轻量 SQLite 方案。
- chunk 结构包含 source path、page/line/offset、text、hash、embedding model。
- `wiki/search` 支持 hybrid search：关键词结果和向量结果合并排序。
- agent 回答必须输出引用，不允许只返回无来源摘要。

验收：

- 同义表达可以命中相关来源。
- 搜索结果可回溯到具体文件和片段。
- 换 embedding 模型后可以重建索引。

### Phase 5: 图谱和自动策展

目标：在可搜索、可引用之后提升知识组织体验。

任务：

- 图谱前端画出真实边，节点大小按 degree，颜色按 type。
- 移除中心 `Vault` 语义，使用 force layout 或已有图谱库。
- WikiPageType 暂时简化为 `note`、`source`、`draft` 或继续兼容旧 6 类但不强依赖。
- LLM 自动摘要、自动 wikilink 建议、自动页面生成都走 review 队列，不直接覆盖用户 wiki。

验收：

- 高互链页面自然聚集，孤岛页面远离主体。
- 用户能接受或拒绝自动建链建议。
- 自动生成内容都有来源和审计记录。

## 性价比排序

| 项目 | 价值 | 成本 | 风险 | 建议 |
|---|---:|---:|---:|---|
| 二进制安全 | 高 | 中 | 高 | 立即做 |
| 关闭/修复 WYSIWYG frontmatter | 高 | 低 | 中 | 立即做 |
| `wiki/search` 关键词检索 | 高 | 中 | 低 | 立即做 |
| agent grounding 接线 | 高 | 中 | 中 | 立即做 |
| health 指标修复 | 中 | 低 | 低 | 立即做 |
| 图谱画边 | 中 | 低 | 低 | Phase 1 或 2 |
| 文本抽取 pipeline | 高 | 中 | 中 | Phase 2 |
| metadata 全文迁移 | 高 | 高 | 中 | Phase 3 |
| embedding/vector | 高 | 高 | 中 | Phase 4 |
| LLM 自动摘要/策展 | 中 | 高 | 高 | 最后做 |

## 不建议现在做

- 不要在 `metadata.blobContents` 上继续叠加更多正文、chunk、embedding 字段。
- 不要先做自动摘要再补引用和检索，摘要会丢上下文且难以验证。
- 不要让 agent 在没有真实搜索结果时声称已参考知识库。
- 不要把图谱当成纯美化任务，图谱布局会影响用户对知识结构的理解。

## 建议的第一批 PR

1. `knowledge-upload-binary-safety`
   - 拒绝或安全保存二进制来源。
   - 增加 PDF 上传 hash 测试。

2. `knowledge-markdown-source-mode`
   - `AssetFileManager` 暴露 `enableRichMarkdown`。
   - KnowledgePage 关闭富文本 Markdown。
   - 增加 frontmatter round-trip 测试。

3. `knowledge-search-health`
   - 实现 `wiki/search`、`wiki/tags`。
   - 修复 `wiki/health`。
   - 将默认 assistant 的知识库检索接到真实只读接口。

4. `knowledge-graph-render`
   - GraphPane 画真实边。
   - 删除中心 Vault 或降级为标题信息。

5. `knowledge-ingestion-v1`
   - source manifest。
   - PDF/DOCX/XLSX 文本抽取。
   - `wiki/reindex` 触发真实重建。

## 成功标准

短期成功不是“我们有完整 RAG”，而是：

- 用户上传资料不会损坏。
- 用户写的 wiki frontmatter 不会被编辑器破坏。
- 用户和 agent 都能检索到真实内容。
- 检索结果有路径、标题和片段。
- 健康度指标可信。
- 未来上 embedding 时不需要推倒已有存储模型。
