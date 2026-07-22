# P0/P1 末尾人工验收清单

本文只列无法在当前自动化环境中可靠替代的人工或外部平台步骤。所有自动化 P0/P1 门禁完成后再执行本清单。不得把 `blocked` / `not_run` 记为 `passed`。

## 1. Microsoft Word 复杂 DOCX 原生往返

状态：`not_run`

1. 在 Microsoft Word 16.110.3 新建文档，加入以下可见元素：
   - 首页页眉文字 `WORD-HEADER-624` 和页码页脚；
   - 两段正文，其中第二段加入批注 `WORD-COMMENT-624`；
   - 一张本地图片，图片下方加入题注；
   - 一个 3×3 表格，合并第一行前两个单元格；
   - 开启“修订”，修改一句话，再关闭修订但不要接受修订。
2. 另存为 `atlas-complex-before.docx`，关闭 Word，再重新打开一次。若 Word 已在此时报告修复，先重新制作基线，不能继续测试。
3. 在 `http://127.0.0.1:5000/#/knowledge` 上传该文件，等待摄取任务为 `succeeded`。
4. 在资源管理器中打开 DOCX，只修改一个普通正文段落，加入 `SHUXIAOAN-WORD-EDIT-624`；不要修改页眉、批注、图片、表格或修订区域。
5. 点击保存，等待“已保存”，切换到另一个文件后再切回，确认新文字仍在。
6. 下载/提取书小安保存后的文件为 `atlas-complex-after.docx`，用 Word 打开。
7. 通过标准：
   - Word 不显示“发现内容有问题/修复文档”；
   - `SHUXIAOAN-WORD-EDIT-624` 存在；
   - 页眉、页脚页码、批注、图片、题注、合并表格和未接受修订均仍存在且位置合理；
   - 继续在 Word 中修改、保存、关闭并重新打开一次，仍无修复提示、无对象丢失。
8. 若在书小安中尝试修改当前不支持的复杂结构，允许保存被明确阻止；不允许提示成功后静默丢失对象。

## 2. Microsoft Excel 复杂 XLSX 原生往返

状态：`not_run`

1. 在 Microsoft Excel 16.110.3 新建工作簿，建立 `Data` 和 `Dashboard` 两张表：
   - `Data!A1:B6` 写入类别和数值；
   - `B7` 写入 `=SUM(B2:B6)`；
   - 设置日期、百分比和货币格式各一列；
   - 合并 `D1:E1`，冻结首行；
   - 在 `Dashboard` 插入引用 `Data!A1:B6` 的柱形图；
   - 插入一张本地图片，并为一个单元格添加批注/备注；
   - 添加至少一个数据验证下拉框。
2. 另存为 `atlas-complex-before.xlsx`，关闭 Excel，再重新打开一次，确认无修复提示且图表正常。
3. 在知识库上传该文件并等待 `succeeded`。
4. 在资源管理器中打开 XLSX，只修改普通值单元格，加入 `SHUXIAOAN-EXCEL-EDIT-624`；不要修改图表、图片或复杂样式。
5. 保存，切换文件后重新打开，确认新值存在。
6. 下载/提取保存后的文件为 `atlas-complex-after.xlsx`，用 Excel 打开。
7. 通过标准：
   - Excel 不显示修复记录；
   - 新值存在，公式仍可计算；
   - 图表数据系列、图片、批注/备注、合并单元格、冻结窗格、数据验证和数字格式均保留；
   - 在 Excel 再修改、保存、关闭并重新打开一次，无修复提示、无对象丢失。
8. 对当前无法安全映射的结构/样式修改，书小安应明确拒绝保存，不能伪成功。

## 3. macOS 正式 `.app` 全新与升级 profile GUI

状态：`blocked`

阻塞原因：现有书小安 Sidecar 正在固定端口 `29653` 提供用户会话；自动测试不得强制结束它。

执行前先退出正在使用的书小安，并确认重要数据已有副本。随后：

1. 备份 `~/.internshannon` 到带时间戳的新目录，不覆盖旧备份。
2. 全新 profile：将测试专用空目录配置为 profile，启动候选 `InternShannon.app`；完成首次配置，创建知识页，上传 TXT/DOCX/XLSX/PPTX，执行检索与一次真实知识库对话；退出并重新打开，确认内容与索引仍在。
3. 升级 profile：复制一份旧版 profile 作为测试副本，用旧版启动并写入 marker；完全退出旧版，再用候选 `.app` 打开同一副本；验证来源 SHA、页面、引用、任务历史和对话接地。
4. 强制退出恢复：在候选执行摄取时强制退出应用，再启动；任务只能恢复、失败或取消为明确终态，不得永久 `running`，raw source 不得损坏。
5. 回退只在测试副本进行：用旧版重新打开升级后的副本，至少确认 raw source 可读；若新格式不兼容，必须有明确诊断而非破坏数据。

## 4. Windows/Linux 真实平台矩阵

状态：`blocked`

当前机器没有 Windows/Linux runner、虚拟机或容器。后续分别在 Windows x64、Linux x64 和 Linux arm64 的真实 runner 上执行：安装依赖、Sidecar/Web/OOXML/OCR 单元测试、生产构建、打包资源检查、全新 profile 启动、上传/摄取/搜索/OKF 导入导出/Office 保存/重启恢复，以及路径分隔符、权限和长路径探针。每个平台必须保存 OS/架构/Node/Rust 版本和机器报告；交叉编译或路径单测不能代替真实运行。

## 5. Apple 签名与公证

状态：`not_run`

按当前决定暂不执行。正式分发前使用真实 Developer ID Application 身份签名，提交 Apple notary service，staple 后验证 `codesign --verify --deep --strict --verbose=2`、`spctl --assess --type execute --verbose=4` 和 `xcrun stapler validate`。证书、Team ID、提交 ID 和完整验证输出应保存到受控发布记录，不写入仓库。

## 结果记录

执行人工项时记录：日期、操作者、候选指纹、应用/Office/OS 版本、输入与输出文件 SHA-256、每一步截图或错误原文、最终 `passed/failed/blocked/not_run`。失败文件保留副本，不覆盖原始黄金文件。
