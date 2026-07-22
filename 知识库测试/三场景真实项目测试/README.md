# 知识库多场景真实项目测试

这组测试不把“对话返回了文字”当成知识库验收。每个场景都建立一个可以导入、编辑、摄取、检索、建图、策展、导出并由智能对话引用的小型项目。

## 六个项目

1. `renewal-operations`：客户续费运营，包含计划、指标、异常处置、TXT/CSV 来源和经营 Office 文件。
2. `literature-research`：学术文献研究，使用仓库中的真实论文 PDF，包含研究问题、方法、证据页和研究 Office 文件。
3. `release-incident`：软件发布与事故复盘，包含发布门禁、时间线、回退策略、风险来源和发布 Office 文件。
4. `internshannon-docs`：InternShannon 知识库交付，使用仓库设计、roadmap 和实施记录作为真实来源，覆盖交付门禁与运行手册。
5. `prompt-security`：Aegis 生产变更审批，包含恶意知识正文，用于验证 prompt injection、只读工具边界和跨项目泄漏。
6. `compliance-lifecycle`：Atlas 合规审计长期演进，覆盖多轮来源、页面和索引演进后的幂等与引用一致性。

六个项目各有唯一事实标记和零命中标记，以防止检索或对话串用其他场景的内容。学术场景摄取 `ASM-Loc`、`E2E-TAD`、`FTCL`、`P-MIL`、`RSKP` 五篇真实 PDF；这些论文不随仓库提交，请将合法取得的文件放在 `知识库测试/`，或通过 `KB_SCENARIO_PDF_DIR` 指向本地目录。

## 验收范围

每个项目至少验证：

- OKF 页面导入、版本校验、相对链接和图谱边。
- TXT/CSV/Office 上传与真实摄取，学术场景额外使用真实 PDF。
- DOCX/XLSX/PPTX 字节往返，浏览器打开无运行时错误；PPTX 通过页面真实修改文字并保存。
- 大文件 `running/queued` 真实状态及取消，普通任务到达 `succeeded`。
- 关键词/混合检索、可打开 citation、评测集、零命中。
- 策展摘要和来源页 proposal 的接受、精确撤销和刷新后恢复 `pending`。
- 统一审计、幂等存储迁移、OKF 导出 ZIP 以及不覆盖重复导入。
- MCP `knowledge_search -> knowledge_read` 真实调用和引用。
- WebSocket 真实模型对话回答唯一事实并给出知识库引用。
- 扩展探针拒绝 OKF 目录穿越、损坏 YAML、缺失 type、5000 文件和 20 MB 越界，并覆盖 MCP JSON-RPC 错误请求。

## 运行

先启动一个使用隔离数据目录的 Sidecar，并使用独立浏览器存储前缀启动 Web。然后在仓库根目录运行：

```bash
KB_SCENARIO_API_URL=http://127.0.0.1:29683 \
KB_SCENARIO_WEB_URL=http://127.0.0.1:5011 \
node 知识库测试/三场景真实项目测试/run-real-project-scenarios.mjs
```

可用 `KB_SCENARIO_SKIP_DIALOGUE=1` 显式跳过需要真实模型凭据的 WebSocket 对话。跳过且未提供配置目录时，隔离编排器会写入一个只用于完成首次 UI 配置、指向不可达本地端口的临时模型；测试不会调用它。报告会标记对话未覆盖，并以 `passed_with_skips` 结束，不会冒充完整通过。

推荐使用隔离编排器。它为每个项目创建全新的 Sidecar 数据目录，避免场景数据互相污染；不跳过对话时必须显式提供本机运行配置目录：

```bash
KB_SCENARIO_CONFIG_DIR="$HOME/.internshannon" \
KB_SCENARIO_PDF_DIR="/path/to/local/papers" \
node 知识库测试/三场景真实项目测试/run-isolated-project-suite.mjs
```

只运行一个项目时可设置 `KB_SCENARIO_ID`。扩展 OKF/MCP 探针默认执行，可用 `KB_SCENARIO_EXTENDED_PROBES=0` 关闭；报告状态严格区分 `passed`、`passed_with_skips` 和 `failed`。
