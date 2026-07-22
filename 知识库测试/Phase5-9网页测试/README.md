# Phase 5-9 网页测试文件

## 文件用途

- `okf-demo-incremental.zip`：导入 OKF 知识包；不含 `index.md`，不会与默认个人知识库根页面冲突。
- `sources/customer-renewal-plan.txt`：测试 TXT 摄取、来源搜索、citation 和来源生成页面建议。
- `sources/revenue-metrics.csv`：测试 CSV 摄取和指标检索。
- `sources/ocr-waiting-sample.png`：未配置 OCR 时应显示“等待 OCR”。
- `generate-queued-fixtures.mjs`：生成两份约 2 MiB 的本地摄取排队夹具，用于同一资产下制造 `running + queued`；生成文件不会提交到仓库。
- `office/knowledge-smoke.docx`：测试 Univer 文档打开、编辑和保存。
- `office/knowledge-smoke.xlsx`：测试 Univer 表格、数值、公式和保存。
- `office/knowledge-smoke.pptx`：由 Microsoft PowerPoint 16.110.3 原生生成的两页 PPTX，包含标题、文本框和蓝色矩形；用于测试 Univer 打开、文本编辑、主题色与图形预览、保存及 PowerPoint 重新打开。夹具带有完整的 slide master、slide layout、theme、Content Types 和 relationship 链，不再是只能被宽松解析器读取的极简 ZIP。

## 固定检索断言

- 搜索 `BQ-7429` 应命中“营收续费计划”或导入的来源资料。
- 搜索 `NRR-2026` 应命中“续费率指标”或 `revenue-metrics.csv`。
- 搜索 `火星咖啡机序列号 MARS-0000` 应返回零命中。

## 推荐网页验收顺序

1. 打开 `http://127.0.0.1:5000/#/`，进入“书小安知识库”。当前产品模型中每个账号固定一个专属个人知识库，不另外创建第二个。
2. 点击顶部“导入 OKF 知识包”图标，选择 `okf-demo-incremental.zip`。预期导入 5 个 concept，并出现 1 条兼容提示；默认库已有的 `wiki/index.md` 继续声明 OKF 0.1。
3. 在“库概览”搜索 `BQ-7429`、`NRR-2026`，确认命中正文而不只是标题。搜索 `MARS-0000` 应为空。
4. 打开“关系图”，分别用 type `Metric`、tag `phase59` 过滤；点击节点检查社区和真实边。在文件树选中 `wiki/metrics/renewal-rate.md` 后打开“反向链接”，应看到营收续费计划的入链。
5. 点击“导入资料”，多选 `sources/` 下的 TXT、CSV、PNG 和 `office/` 下的三个文件。TXT、CSV、DOCX、XLSX 应被索引，PNG 在未配置 OCR 时应显示“等待 OCR”，PPTX 当前只用于直接编辑且摄取状态为 unsupported。
6. 打开“任务与审计”，确认任务从 queued/running 到 succeeded，进度达到 100%，审计中出现 `ingest.complete`。小文件可能太快，取消按钮不一定来得及出现。
   - 要稳定观察 `queued`，先在本目录运行 `node generate-queued-fixtures.mjs`，再单独导入生成的 `sources/queued-ingest-a.txt`，随后立即单独导入 `sources/queued-ingest-b.txt`。
   - 同一知识库的写索引任务串行：第一个应为 `running`，第二个应短暂为 `queued`。只取消 `queued/running`；`succeeded` 已经完成，不提供“撤销”。
   - 选择文件后应立即自动打开“任务与审计”并显示读取/上传卡片；此时“导入资料”仍可点击。
7. 在文件树的 `raw/sources/` 依次打开 DOCX、XLSX、PPTX：修改内容后状态应变成“未保存”，点击“保存”，关闭并重新打开后内容仍存在。PPTX 第二页应同时显示文本 `111` 和由 Office 主题 `accent1` 提供颜色的蓝色矩形；保存后将二进制文件提取并用 Microsoft PowerPoint 重新打开，不应出现“发现内容有问题”或“修复”提示，蓝色矩形的位置、大小和颜色应保持。
8. 点击“刷新索引”，再搜索来源中的 `客户沟通检查点`。命中项应带 `asset://.../raw/sources/customer-renewal-plan.txt` citation。
9. 打开“策展建议”并刷新。至少应出现摘要 proposal 和来源页面 proposal；接受前不得创建或改写页面。接受后检查文件内容，再点击撤销，内容应精确恢复。
10. 再接受一条建议，随后手工编辑对应页面并保存，再点击撤销。预期显示 SHA 冲突错误，手工内容不得被覆盖。
11. 打开“检索配置”，确认默认 `local / local-hash-v1 / 192`。可调整 keyword/vector 权重与 MMR lambda 并保存；没有配置真实 provider 时不要把 Provider 改成外部名称。
12. 在“任务与审计”点击数据库图标执行存储迁移。第一次可能迁出旧 scaffold，第二次应显示 0 个文件迁移；所有页面和 Office 文件仍应可打开。
13. 点击顶部“导出 OKF 知识包”，确认浏览器下载 ZIP。再次导入同一个增量 ZIP 应提示文档已存在，证明默认不静默覆盖。
14. 进入智能对话，发送：`请先搜索我的个人知识库：蓝鹊校验码是什么？给出具体文件引用。` 预期回答 `BQ-7429`，并引用 OKF path 或 `asset://` 来源。再询问 `火星咖啡机序列号 MARS-0000 是什么？`，预期明确说明个人知识库未找到。

详细实现和自动化验证结果见 `docs/knowledge-base-implementation.md`。
