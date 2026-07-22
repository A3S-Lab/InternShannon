# 知识库外部依赖真实验收

这组测试与 mock adapter 单元测试分开，只有确认真实引擎、真实 HTTP provider 或真实桌面应用已被调用时才记为通过。

## 覆盖范围

- tesseract-ocr-provider.mjs：将本机 Tesseract CLI 以项目 custom OCR 合同暴露为隔离 HTTP provider。
- run-ocr-quality-probes.mjs：验证清晰英文、中英混合、低对比旋转件和扫描 PDF，中英混合字符准确率 95% 为硬门槛。
- run-real-provider-suite.mjs：复制主配置到临时目录，启用 Tesseract HTTP OCR 和 boyue/text-embedding-3-small，以四个全新 Sidecar 数据目录执行真实项目场景。主配置和个人知识库不会被修改。
- run-microsoft-office-fidelity.mjs：对临时 DOCX/XLSX/PPTX 副本调用真实 Microsoft Office，再次解析 OOXML 确认 marker 和关键结构。
- run-libreoffice-fidelity.mjs：调用正式 LibreOffice Writer/Calc/Impress 导入 OOXML，在原生 ODF 中加入唯一内容标记后由 LibreOffice 导出，再由书小安 OOXML adapter 编辑保存并交给 LibreOffice 二次重开。
- libreoffice-roundtrip.spec.mjs：对 ODF 标记注入、XML 转义和损坏文档拒绝做纯单元测试。

## 运行方式

所有场景脚本要求 Node 22：

    npx -y node@22.23.1 知识库测试/外部依赖真实验收/run-real-provider-suite.mjs

OCR 质量探针需要先启动 provider：

    node 知识库测试/外部依赖真实验收/tesseract-ocr-provider.mjs
    node 知识库测试/外部依赖真实验收/run-ocr-quality-probes.mjs

Office 验收会启动 GUI 应用，需要 macOS 授权：

    npx -y node@22.23.1 知识库测试/外部依赖真实验收/run-microsoft-office-fidelity.mjs

LibreOffice 往返、探针和三个业务内容场景：

    node --test 知识库测试/外部依赖真实验收/libreoffice-roundtrip.spec.mjs
    npx -y node@22.23.1 知识库测试/外部依赖真实验收/run-libreoffice-fidelity.mjs

## 结果文件

- latest-real-provider-report.json：真实 OCR + embedding 四场景结果。
- latest-ocr-quality-report.json：OCR 准确率和扫描 PDF 结果。
- latest-microsoft-office-report.json：Microsoft Office 外部保真矩阵。
- latest-libreoffice-report.json：LibreOffice 安装、过滤器探针和三场景往返结果。
- latest-libreoffice-scenarios-report.json：LibreOffice 接入完整 Sidecar/Web 隔离项目链路的三场景结果。
- runs/：原始日志和单场景证据，只保留在本机并被 Git 忽略。

报告中的 blocked 表示本机环境不满足验收条件，不会被冒充为 passed。API key 不写入报告或日志。
