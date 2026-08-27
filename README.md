# InternShannon（书小安）

InternShannon 是一个本地优先的桌面工作空间，面向两个核心场景：智能体会话和知识库管理。桌面客户端负责用户体验，Sidecar 负责本地 API 协调、配置、工作空间访问、资源元数据、智能体会话以及外部集成。

项目遵循一个基本原则：桌面助手不应依赖云端控制平面才能发挥作用。应用应当能够在本机启动、在本机保存状态，并明确标识每一项外部依赖。

## 仓库内容

本仓库包含桌面壳、Web 前端、本地 Sidecar 运行时以及跨平台打包工具：

- `apps/desktop`：基于 Tauri v2 的桌面应用及 Windows、macOS 打包工具链。
- `apps/web`：桌面客户端使用的 React 18 + Rsbuild 前端。
- `apps/sidecar`：随桌面客户端运行的 NestJS 本地 API Sidecar。
- `packages/*`：Sidecar 与桌面工具共用的基础库。
- `packaging/rc`：受控依赖、跨平台同步和 RC 构建合同。

默认目标是单用户桌面安装。桌面链路不依赖 IAM、PostgreSQL 或 Kubernetes。为兼容旧接口，部分位置可能保留轻量适配层，但桌面访问仍以本地能力为中心，而不是以账号登录或多租户服务为中心。

## 核心约束

- 本地优先：没有集群基础设施时，应用仍应具备完整的本地使用价值。
- 边界明确：领域代码不得依赖传输层、存储实现或框架细节。
- 桌面运行时优先：除非模块明确声明其他集成方式，适配器默认采用本地文件或桌面运行时实现。
- 缩小可信面：Sidecar API 是本机桌面 API，不应演变为通用多租户后端。
- 聚焦产品：桌面端以智能体会话和知识库管理为主；OCR、规划等能力通过独立包边界接入。
- 跨平台受控：共享源码统一合并，Windows 与 macOS 的平台原生依赖分别恢复、校验和打包，不将平台二进制提交到普通 Git 历史。

## 当前路线

知识库能力按以下顺序演进：

- 先稳定存储和编辑器基础，避免二进制源文件损坏，保护 Markdown frontmatter，并防止内部快照文件出现在用户文件树中。
- 在完整 RAG 之前，先让现有知识库可搜索：提供真实的 `wiki/search` 链路、接入默认助手，并确保断链和孤立页面等健康指标可信。
- 逐步增加导入能力：从 PDF、Office 和文本文件中提取内容并生成分块清单；待文本管线和引用链路稳定后，再接入嵌入和本地向量检索。
- 图谱和自动整理属于核心“读取—检索—引用”闭环稳定后的增强能力。

详细评估、分阶段计划和验收标准见 [知识库路线图](docs/knowledge-base-roadmap.md)。

## 架构

Sidecar 采用有界上下文分层：

```text
apps/sidecar/src
  modules/
    assets/
      domain/
      application/
      infrastructure/
      presentation/
    config/
    kernel/
    loop/
  runtime/
    desktop/
  shared/
    domain/
    api/
    infrastructure/
    security/
```

各层职责如下：

- `domain`：实体、值对象、端口和业务合同。
- `application`：编排用例，并依赖领域端口。
- `infrastructure`：实现桌面文件持久化等适配器。
- `presentation`：提供 HTTP/WebSocket 控制器、DTO 和拦截器。
- `runtime/desktop`：装配仅用于桌面端的模块依赖图。
- `shared/domain`：保持与框架无关；Nest、Swagger、校验器和传输 DTO 应放在 API 或 presentation 层。

可使用边界检查器验证主要导入和目录约束：

```bash
pnpm sidecar:ddd:check
```

## 目录结构

```text
.
  apps/
    desktop/      Tauri 桌面壳、发布脚本和本地诊断
    sidecar/      NestJS 桌面 Sidecar 运行时
    web/          桌面 Web 前端
  packages/
    agent-planning/
    lark/
    ocr/
    ooxml/
  packaging/
    rc/           受控依赖与跨平台 RC 打包合同
  pnpm-workspace.yaml
```

## 环境要求

- Node.js `22.18.0`
- pnpm `11.19.0`
- 构建桌面壳时需要 Rust 工具链
- Tauri 在目标平台要求的系统工具：
  - Windows：Windows 构建工具与 WebView2 运行环境
  - macOS：Xcode Command Line Tools

Sidecar 的普通构建链路不需要 Docker、PostgreSQL、Redis 或 Kubernetes。

## 安装依赖

```bash
pnpm install
```

RC 构建使用受控 A3S 输入时，请先阅读 [RC 打包说明](packaging/rc/README.md) 和对应平台合同。平台原生依赖必须在目标操作系统上恢复和验证。

## 常用命令

构建 Sidecar：

```bash
pnpm sidecar:build
```

运行 DDD 边界检查：

```bash
pnpm sidecar:ddd:check
```

运行桌面环境诊断：

```bash
pnpm desktop:doctor
```

为桌面应用暂存 Sidecar 资源：

```bash
pnpm desktop:stage-sidecar
```

运行工作区中所有已定义的测试脚本：

```bash
pnpm test
```

## Sidecar 开发

Sidecar 入口文件：

```text
apps/sidecar/src/intern-shannon-sidecar.module.ts
```

桌面运行时会设置：

```text
APP_MODE=desktop
KERNEL_WORKSPACE_STORAGE_PROVIDER=local
PIPELINE_RUNNER_DRIVER=none
```

本地状态默认保存在 `~/.internshannon`，也可以通过以下环境变量覆盖：

```text
INTERNSHANNON_DATA_DIR
INTERN_SHANNON_DATA_DIR
```

## 桌面端开发

桌面应用位于 `apps/desktop`。该应用会把 Sidecar 及目标平台所需的受控资源打包为本地资源。

常用命令：

```bash
pnpm --filter @internshannon/desktop doctor:test
pnpm --filter @internshannon/desktop stage:sidecar
pnpm --filter @internshannon/desktop tauri:build
```

Windows 与 macOS 使用同一冻结共享源码，但原生 A3S、Node、搜索浏览器资源以及安装包必须在各自平台独立构建和校验。跨平台同步约束及来源记录位于 `packaging/rc`。

## 提交前验证

影响 Sidecar 或桌面运行时的变更，至少应运行与修改范围相匹配的检查：

```bash
pnpm sidecar:ddd:check
pnpm exec tsc -p apps/sidecar/tsconfig.build.json --noEmit
node apps/sidecar/scripts/build-desktop-sidecar.mjs
pnpm --filter @internshannon/desktop doctor:test
```

修改桌面打包元数据时，还应校验 Tauri manifest：

```bash
cargo metadata --manifest-path apps/desktop/src-tauri/Cargo.toml --no-deps --format-version 1
```

发布候选还必须在目标平台完成受控依赖校验、生产构建、安装、首次启动和正常退出验证。未签名或未公证的内部构建必须在发布说明中明确标识，不能描述为正式签名产物。

## 命名约定

- 面向用户的桌面客户端名称为“书小安”。
- 仓库、npm scope 和内部代码标识继续使用 `InternShannon` / `internshannon`，避免破坏现有工具链。

```text
@internshannon/workspace
@internshannon/desktop
@internshannon/sidecar
```

Rust crate 标识遵循 Rust 的小写或 snake_case 要求；代码局部约定需要 camelCase 时可使用 `internShannon`。

## 开发原则

- 优先使用本地文件适配器和桌面运行时，不引入不必要的服务基础设施。
- 领域合同不得依赖 NestJS、Swagger、校验器或传输 DTO。
- 运行时专用装配放在 `runtime/desktop`，不得下沉到领域代码。
- README、诊断脚本和边界检查都属于产品交付面；它们应描述已经成立的事实。
