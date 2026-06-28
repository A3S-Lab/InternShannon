import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { LoopControllerRegistry } from '@/modules/loop/application/loop-controller-registry';
import { LoopSpecRegistry } from '@/modules/loop/application/loop-spec-registry';
import {
    LoopController,
    LoopStepResult,
    LoopTriggerEvent,
    TerminationVerdict,
    type LoopRunSnapshot,
} from '@/modules/loop/domain/services/loop-controller.interface';
import type { LoopSpec, LoopSpecProvider } from '@/modules/loop/domain/services/loop-spec.interface';

/**
 * Dev loop — read-only spec provider (third of the three loops).
 *
 * ★ The dev loop is the interactive OrchestrationAgent loop that closes via CROSS-TURN PROMPT
 * INJECTION (extra() re-rendering verify issues), driven by real user turns + live socket emit —
 * NOT by the LoopRunDriver (review §4.3: driving it through a setInterval driver is a real behavior
 * change, not zero-cost). It registers ONLY the read-only `dev` SPEC (for the /loops/specs modeling
 * page). It does NOT register into the LoopControllerRegistry: that registry is keyed by `kind`, and
 * the `dev` controller slot is owned by DiagnoseLoopController (the dev:diagnose DRIVEN mode — see
 * diagnose-loop.controller.ts). The interactive dev loop is never driver-scheduled and creates no
 * loop_runs, so it needs no controller slot. step()/shouldTerminate are defensive only.
 */
@Injectable()
export class DevLoopSpecProvider implements LoopController, LoopSpecProvider, OnModuleInit {
    readonly kind = 'dev' as const;
    readonly laneId = 'prompt' as const; // dev loop is model/LLM-generation paced
    private readonly logger = new Logger(DevLoopSpecProvider.name);

    constructor(
        // Kept for DI/positional-construction compatibility, but no longer used: this provider
        // registers only its SPEC (the `dev` controller slot is owned by DiagnoseLoopController).
        _registry: LoopControllerRegistry,
        private readonly specs: LoopSpecRegistry,
    ) {}

    onModuleInit(): void {
        // SPEC only — the `dev` controller-registry slot is owned by DiagnoseLoopController.
        this.specs.register(this);
        this.logger.log('Dev loop registered as read-only spec (interactive; not driver-managed)');
    }

    isAvailableInMode(_mode: 'cloud' | 'desktop'): boolean {
        return false; // never driver-scheduled; the OrchestrationAgent turn loop is the real driver
    }

    shouldTerminate(_run: LoopRunSnapshot): TerminationVerdict {
        return { stop: true, status: 'terminated', reason: 'dev_loop_not_driver_managed' };
    }

    async step(input: { run: LoopRunSnapshot; trigger: LoopTriggerEvent | null }): Promise<LoopStepResult> {
        // Should never be reached (driver excludes unavailable controllers + no scanner enqueues dev runs).
        return {
            status: 'terminated',
            nextState: input.run.state,
            errorSignature: 'dev_loop_not_driver_managed',
            budgetSpent: { iterations: 0 },
        };
    }

    /**
     * Read-only model of the dev loop. Unlike ops/knowledge it is NOT driver-managed — it closes
     * via cross-turn prompt injection inside the interactive OrchestrationAgent turn loop (extra()
     * re-rendering verify issues on each real user turn). So `enforcement` here reflects "the interactive
     * agent loop enforces this" rather than "the LoopRunDriver enforces this"; almost every loop_runs-table
     * guardrail is declaredOnly for the dev loop because no loop_run row is ever created for it.
     */
    loopSpec(): LoopSpec {
        return {
            key: 'dev',
            loopKind: 'dev',
            name: '软件本质复杂性循环:把"需求→实现→验证→修复"的反复试错收敛为可重复的智能体协作,降低人工返工成本、提升交付质量',
            trigger: {
                kinds: ['manual', 'goal-unmet'],
                detail:
                    '由真实用户对话轮次驱动(internShannon/OrchestrationAgent),每轮 LLM 生成后将未通过的验证(verify issues)经 extra() 跨轮重注入,直到目标达成。不经 LoopRunDriver / loop_runs 表,也无扫描器入队。',
            },
            scope: {
                subjectTypes: ['session', 'workspace'],
                description: '一个会话工作区内的软件交付目标(代码/工作流/资产仓库的编辑与验证)。',
            },
            context: {
                rules:
                    '上下文 = 会话历史 + 工作区文件 + 上一轮验证结果;模型按对话上下文自驱,无固定 read/write 围栏(由会话工作区与用户授权约束)。',
            },
            action: {
                steps: [
                    SOFTWARE_PLAN_PROMPT,
                    SOFTWARE_IMPLEMENT_PROMPT,
                    SOFTWARE_VERIFY_PROMPT,
                    SOFTWARE_REPAIR_PROMPT,
                ],
                description:
                    '规划 → 实现 → 验证 → 修复,以模型生成节奏迭代;失败的验证项通过 extra() 跨轮注入回提示词,形成闭环。',
            },
            evaluator: {
                method: ['test', 'lint', 'screenshot', 'reviewer-agent'],
                detail:
                    '验证由会话内工具(测试/lint/截图/审阅智能体)产出;不通过项作为下一轮 prompt 的输入。非命令式重试,而是上下文注入。',
            },
            stateContinuation: {
                ledger:
                    '跨轮态 = 会话消息历史 + 工作区持久文件(非 loop_runs.state)。软件循环不写 loop_runs 行,故无 DAG 累积器/事件溯源逃生口。',
            },
            inputSources: ['会话对话', '工作区文件', '验证工具输出'],
            trust: { trusted: ['工作区文件', '验证工具输出'], reference: ['会话对话'] },
            readScope: ['会话工作区'],
            writeScope: { default: 'writable', where: '会话工作区文件(经用户授权的写)' },
            isolation: 'none',
            processAssets: {
                prompts: {
                    plan: SOFTWARE_PLAN_PROMPT,
                    implement: SOFTWARE_IMPLEMENT_PROMPT,
                    verify: SOFTWARE_VERIFY_PROMPT,
                    repair: SOFTWARE_REPAIR_PROMPT,
                },
            },
            validation: '验证项不通过即跨轮重注入;由会话工具(测试/lint/截图/审阅)判定。',
            budgetDefaults: {
                note: '无 loop_runs 预算字段;预算 = 模型上下文窗口 + 用户对话轮次,由交互节奏天然约束。',
            },
            stopConditions: ['目标达成(验证全过)', '用户结束会话'],
            humanEscalation: '用户本人在每一轮即时介入(交互式闭环,人始终在环)。',
            rollback: '工作区编辑通过 git 历史回退;无自动回滚动作。',
            retroEntry: null,
            availability: { cloud: true, desktop: true },
            enforcement: {
                // The interactive agent loop genuinely drives action/evaluator/state via the live turn loop.
                enforced: ['trigger', 'action', 'evaluator', 'stateContinuation', 'availability'],
                // No loop_runs row exists for the dev loop, so every table-backed guardrail is modeling-only here.
                declaredOnly: [
                    'scope',
                    'context',
                    'inputSources',
                    'trust',
                    'readScope',
                    'writeScope',
                    'isolation',
                    'budgetDefaults',
                    'stopConditions',
                    'humanEscalation',
                    'rollback',
                ],
            },
        };
    }
}

/** Fixed operative instructions (提示词) modeling the dev loop's per-phase intent. */
const SOFTWARE_PLAN_PROMPT = '规划:理解需求,拆解为可验证的实现步骤';
const SOFTWARE_IMPLEMENT_PROMPT = '实现:在会话工作区编辑代码/工作流/资产以满足步骤';
const SOFTWARE_VERIFY_PROMPT = '验证:运行测试/lint/截图/审阅智能体,收集未通过项';
const SOFTWARE_REPAIR_PROMPT = '修复:将未通过项经 extra() 跨轮注入回提示词,继续迭代';
