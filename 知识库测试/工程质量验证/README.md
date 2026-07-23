# 知识库工程质量验证

这里保存 roadmap 功能验收之后的高优先级工程质量测试。所有真实进程测试默认使用临时数据目录，不会改写用户的 `~/.internshannon` 知识库。

## 优先级

1. 故障注入和数据恢复：强制终止 Sidecar，复用原数据目录重启，验证中断任务恢复、重试、源文件 SHA 和检索结果。
2. 规模、性能和长稳：大批量 OKF、大文件、重复索引和检索延迟分布。
3. OKF、OOXML 和 MCP 模糊/属性测试。
4. Prompt injection、越权与跨场景泄漏对抗测试。
5. Office golden file 与视觉回归。
6. Node/操作系统/浏览器兼容矩阵。
7. 受控变异测试，验证测试能否发现关键逻辑被破坏。

## 故障恢复测试

```bash
pnpm --filter @internshannon/sidecar build
node 知识库测试/工程质量验证/run-chaos-recovery.mjs
```

输出会写入 `latest-chaos-recovery-report.json`。设置 `KB_CHAOS_KEEP_DATA=1` 可保留隔离数据目录用于调查。

## 规模与长稳测试

```bash
node 知识库测试/工程质量验证/run-scale-performance.mjs
```

默认导入 1000 个 OKF 页面、摄取 4 MiB 原始文件、重建 3 轮索引并执行 200 次检索。可用 `KB_SCALE_PAGE_COUNT`、`KB_SCALE_QUERY_COUNT` 和 `KB_SCALE_REINDEX_ROUNDS` 调整档位。

## 格式和协议模糊测试

OKF 路径/YAML 与 OOXML 字节变异由各自单测保护；MCP 真实 HTTP 协议模糊测试使用：

```bash
node 知识库测试/工程质量验证/run-mcp-fuzz.mjs
```

## 视觉结构合同

Browser 真实页面截图保存在 `visual-artifacts/`。下列探针验证截图尺寸、第二页蓝色矩形的核心像素和背景对比：

```bash
node 知识库测试/工程质量验证/run-visual-contract.mjs
```

`write-compatibility-report.mjs` 记录当前主机、Node、内置浏览器和外部 Office 证据。它不会根据“软件已安装”自动宣称通过；只有完成同一候选的实际测试后，才通过 `KB_COMPAT_CURRENT_NODE_STATUS`、`KB_COMPAT_NODE22_STATUS`、`KB_COMPAT_POWERPOINT_STATUS` 或 `KB_COMPAT_LIBREOFFICE_STATUS` 标记对应项。未提供的 Windows/Linux 环境保持 `not_run`。

## 受控变异结果

`write-mutation-report.mjs` 会验证并归档三个临时变异的 Jest 失败证据：索引提交点取消保护、OKF 路径越界保护和 PPTX 页序保护。每个变异都必须在独立临时 worktree 中运行并恢复源码，日志放入 `KB_MUTATION_EVIDENCE_DIR`（默认 `mutation-evidence/`）；脚本不会直接改写产品源码。

最终聚合产物为 `latest-engineering-quality-summary.json`，它只引用各阶段稳定 JSON，不硬编码历史测试数量。可用 `KB_ENGINEERING_SCENARIO_REPORT` 指定本轮隔离项目报告；原始进程日志和临时数据目录受 `.gitignore` 保护。
