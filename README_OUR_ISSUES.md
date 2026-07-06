# 书小安侧问题归档

本文只记录本轮真实链路测试中可归因为书小安代码、配置、协议适配或测试编排的问题；不包含模型自身能力或生成质量问题。

## 1. 空配置默认模型会直接触发 API Key 错误（已修复）

- 现象：使用空临时配置启动真实链路后，`session_status` 返回 `No valid API key configured for default model openai/gpt-4`。
- 归因：配置默认值将 `llm.defaultModel` 设为 `openai/gpt-4`，同时默认 `providers` 为空；运行时构建器在找不到可用 provider key 时抛出错误。
- 影响：新环境或空配置环境下，用户可能在未显式选择模型前就遇到默认模型不可用错误。
- 相关位置：
  - `apps/sidecar/src/modules/config/domain/services/settings-schema.ts`
  - `apps/sidecar/src/modules/kernel/application/kernel-runtime-config.builder.ts`
- 建议：空配置下提供更明确的初始化引导，或避免把不可用模型作为无条件默认值；错误消息可以区分“未配置任何模型”和“默认模型缺 key”。
- 修复状态：
  - 已将空安装默认 `llm.defaultModel` 从 `openai/gpt-4` 改为空字符串，避免预填一个不可用模型。
  - 已让 runtime builder 区分“完全没有配置模型”和“显式默认模型缺少 API key”：空配置报 `No AI model configured...`；显式配置了 `openai/gpt-4o` 但无 key 时仍保留具体 missing-key 错误。
  - 已补单元测试：`settings-schema.spec.ts` 覆盖默认 LLM 不预选模型；`kernel-runtime-config.builder.spec.ts` 覆盖空配置错误不再提 `openai/gpt-4`，以及显式默认模型仍保留具体错误。
  - 已补集成式测试：`desktop-kernel-runtime-config.service.spec.ts` 覆盖 desktop runtime config 不会把空设置重新注入为 `openai/gpt-4`。
  - 已做真实链路验证：临时启动 Sidecar，使用空 data dir 且清除 `OPENAI_API_KEY`，经 WebSocket 调 `session_status`，返回 `No AI model configured...`，`mentionsOpenAiGpt4 = false`。

## 2. `confirmation_received` 事件未被 normalizer 识别（已修复）

- 现象：真实链路中出现 `confirmation_received` 相关 unhandled event 日志。
- 归因：`confirmation_received` 属于 SDK/运行时事件，不是模型输出；当前事件 normalizer 的 recognized event 集合没有包含该事件。
- 影响：工具确认流程实际可以继续，但日志会制造误报，干扰排障。
- 相关位置：
  - `apps/sidecar/src/modules/kernel/application/kernel-stream-event-normalizer.ts`
- 建议：将 `confirmation_received` 加入生命周期或 hook 类已知事件；如果前端需要展示，则规范化为明确的 stream event。
- 修复状态：
  - 已将 `confirmation_received` 加入已知生命周期事件，作为无用户可见 payload 的 SDK bookkeeping 事件静默丢弃。
  - 已补单元测试：`kernel-stream-event-normalizer.spec.ts` 覆盖 `isKnownEventType("confirmation_received") === true` 且 normalize 返回 `null`。
  - 已补集成式测试：`kernel-message-runner.service.spec.ts` 覆盖 runner 收到该事件后不 warning、不向浏览器发出 `confirmation_received` 噪声事件，最终 run 仍成功。
  - 已做真实链路验证：临时启动 Sidecar，经 WebSocket 发送真实 `user_message`，触发两次 `write` 工具确认，最终文件内容为 `OK`，`unhandledConfirmationReceivedCount = 0`。

## 3. 工具确认 ID 匹配日志存在误导（已修复）

- 现象：真实链路中出现类似 `confirmation_not_found approved=true` 的日志；从用户视角看工具仍然继续执行。
- 归因：确认请求、SDK pending confirmation、`session.confirmToolUse` 之间存在多套 ID 匹配与 fallback 逻辑；本轮进一步确认到 SDK 会连续发出同一 `toolId` 的重复 `confirmation_required` 事件。第一次确认成功后 pending 已被消费，第二次重复事件再次调用 `confirmToolUse` 会返回 false，从而误报 `confirmation_not_found approved=true`。
- 影响：排查时容易把成功确认误判为确认失败。
- 相关位置：
  - `apps/sidecar/src/modules/kernel/application/kernel-tool-confirmation.service.ts`
  - `apps/sidecar/src/modules/kernel/presentation/gateways/websocket-confirmation-manager.ts`
- 建议：日志中区分“最终失败”“fallback 成功”“SDK 已消费但本地未命中”；同时记录 requestId、toolId、pendingToolId 的映射关系。
- 修复状态：
  - 已在 `KernelToolConfirmationService` 中加入短 TTL 的 session/toolId 级确认结果缓存，对同一 SDK toolId 的重复 `confirmation_required` 做幂等复用。
  - 重复事件不再二次请求前端授权、不再重复调用 `session.confirmToolUse`、不再产生 `confirmation_not_found` warning。
  - 已补单元测试：`kernel-tool-confirmation.service.spec.ts` 覆盖同一 `toolId` 重复确认只请求一次前端授权、只调用一次 `confirmToolUse`。
  - 已补集成式测试：`kernel-message-runner.service.spec.ts` 覆盖 runner 收到连续两个相同 `confirmation_required` 时 run 成功且不产生 `confirmation_not_found`。
  - 已做真实链路验证：临时启动 Sidecar，经 WebSocket 发送真实 `user_message`，模型触发 `write` 工具；SDK 仍发出两次同一 toolId 的 confirmation_required，但前端确认请求只有 1 次，最终文件内容为 `OK`，`relevantWarnings = []`。

## 4. 大工具输入场景下 stall 观测噪声偏大（已修复）

- 现象：模型生成较大的 `write` 工具输入时，运行中出现 `tool_input_streaming` 阶段的 `kernel.stream.stalled` 警告。
- 归因：模型确实可能长时间流式生成大 JSON/tool input；但 stall watcher 的告警阈值和日志语义由书小安侧决定。当前告警容易把“慢速大输入”表现成“疑似卡死”。
- 影响：真实长任务中日志噪声变多，用户或研发可能误判链路不稳定。
- 相关位置：
  - `apps/sidecar/src/modules/kernel/application/kernel-message-runner.service.ts`
  - `apps/sidecar/src/modules/kernel/presentation/dto/request/create-session.request.dto.ts`
  - `apps/sidecar/src/modules/kernel/domain/services/session-runtime.contract.ts`
- 建议：对 `tool_input_streaming` 阶段单独设计更温和的心跳文案和阈值；日志中说明这是“仍在接收工具输入”而不是默认暗示卡死。
- 修复状态：
  - 已将 `tool_input_streaming` 阶段的软心跳从 `stream_stalled` 拆分为 `tool_input_stream_waiting`，日志从 warning 降为普通 log：`[kernel.stream.tool_input_waiting]`。
  - 硬超时保护保持不变：真正超过 `toolInputStreamStallHardMs` 时仍发 `tool_input_stream_stalled`，并进入既有取消/自动续跑逻辑。
  - 前端 timeline 已识别 `tool_input_stream_waiting`，展示为“工具参数生成等待中”，不会再归入普通 stream event 队列或显示成“工具执行已无响应”。
  - 已补单元/集成式测试：`kernel-message-runner.service.spec.ts` 覆盖软等待不发 `kernel.stream.stalled` warning、不发 `stream_stalled`；`stream-stalled-activity.spec.ts` 覆盖前端文案。
  - 已做真实 WebSocket 链路验证：临时启动 Sidecar，经 `/ws/kernel` 发送“KTV：点歌系统”大 JSON 文件创建任务，真实模型创建 `ktv-large-catalog.json`（13,926 bytes），run 成功 `stopReason=end_turn`；链路中 `toolInputWaitEventCount > 0`，`toolInputStreamStalledSoftEventCount = 0`，`hardToolInputStallCount = 0`，`badToolInputStalledWarningCount = 0`。

## 5. 后端驱动多轮回归测试的证据采集不完整（已修复）

- 现象：最终产物缺少“管理员模式、导入/导出 JSON”等增强需求，但本地持久化轨迹中只明确看到初始需求和“重复点歌/拼音搜索”变更轮，没有完整保存管理员增强轮的提示与运行结果。
- 归因：本轮测试 harness 的等待、采集和结果落盘策略不足，无法稳定证明每一轮需求都被模型完整接收、执行并落盘。
- 影响：当产物缺功能时，难以准确区分是模型忽略需求、运行链路中断、还是测试编排提前结束。
- 建议：后端 real-chain 测试应为每个 turn 固定记录：
  - prompt 内容和发送时间；
  - websocket 收到的首包、首个 assistant、result、idle 时间；
  - 所有 terminal frame；
  - run snapshot id；
  - 最终文件审计摘要；
  - turn 与产物变更的关联。
- 修复状态：
  - 已在现有 `apps/web/scripts/desktop-smoke.mjs` 中增强 `runSocketUserMessage`：不再在首个 assistant/result 任一出现后立刻返回，而是等待真正终态 `result` 或 `error`，避免漏采 assistant 后续的 result frame。
  - 已新增 `summarizeSocketRunEvidence`，为每个 turn 输出 prompt、发送/完成时间、首包类型、首个 assistant/result/error 位置、终态 status/stopReason、terminal frame、确认请求数、stream event 类型计数。
  - 已补 `desktop-smoke.spec.mjs` 单元测试，覆盖终态证据摘要和 terminal/result 判定。
  - 该项属于测试 harness 缺陷，不是产品运行时缺陷；无需改 WebSocket 协议或模型调用链路。

## 6. 初始测试 harness 的工具安全策略过严（已修复）

- 现象：第一版测试中，安全策略误把合法写入拦截，导致模型连续遇到工具拒绝。
- 归因：测试 harness 对工具输入做了过宽的字符串扫描，把代码内容中的普通字符或注释也当成危险路径/命令。
- 影响：该轮不能作为模型生成失败的证据；同时说明测试代理自身需要更精确地区分命令字段、路径字段和普通文件内容。
- 建议：只对明确的 command/path 字段执行安全规则；对写入内容不要做全局危险字符串扫描，除非工具语义确实会执行该内容。
- 修复状态：
  - 已在现有 `apps/web/scripts/desktop-smoke.mjs` 中为自动工具确认增加可选 guard：按 `toolName`、显式 path 字段、显式 command 字段判断是否放行。
  - 安全检查不再扫描普通写入内容，因此文档、源码或 JSON 内容里出现类似 `rm -rf` 的普通文本不会被误判为危险命令。
  - 明确 command 字段仍会拦截 `rm -rf`、`sudo`、`chmod` 等危险命令；path guard 会要求命中本轮 smoke 期望的文件名片段。
  - 已补 `desktop-smoke.spec.mjs` 单元测试，覆盖“写入内容含危险文本但路径合法仍放行”和“command 字段危险命令拦截”。
  - 该项同样属于测试 harness 缺陷，不是模型或书小安运行时生成能力问题。

## 优先级建议

1. 先修确认事件识别和确认日志语义，降低真实链路排障噪声。
2. 再调整空配置默认模型体验，减少新环境误报。
3. 接着优化 `tool_input_streaming` stall 告警文案和阈值。
4. 最后把 real-chain 测试 harness 的 turn 级证据采集规范化，避免后续问题归因不清。（已完成）
