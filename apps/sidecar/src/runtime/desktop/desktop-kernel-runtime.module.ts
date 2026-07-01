import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { AppConfigModule } from '@/modules/config/infrastructure/desktop/app-config/app-config.module';
import { DesktopKernelService } from '@/modules/kernel/infrastructure/desktop/services/desktop-kernel.service';
import { DesktopMessageRepository } from '@/modules/kernel/infrastructure/desktop/repositories/desktop-message.repository';
import { DesktopSessionRepository } from '@/modules/kernel/infrastructure/desktop/repositories/desktop-session.repository';
import { LocalFileStorage } from '@/modules/kernel/infrastructure/workspace-storage/local-file.storage';
import { AgentLifecycleMediator } from '@/modules/kernel/application/agent-lifecycle-mediator.service';
import { AgentRegistry, AssetAgent, DefaultAgent } from '@/modules/kernel/application/agents';
import { LockedAgentSessionStore } from '@/modules/kernel/application/agents/locked-agent-session.store';
import { ApiOperationExecutor } from '@/modules/kernel/application/api-operation-executor.service';
import { CapabilitiesToolService } from '@/modules/kernel/application/capabilities-tool.service';
import { CreateSessionHandler } from '@/modules/kernel/application/commands/create-session';
import { EndSessionHandler } from '@/modules/kernel/application/commands/end-session';
import { KernelBtwQueryService } from '@/modules/kernel/application/kernel-btw-query.service';
import { KernelConversationLogService } from '@/modules/kernel/application/kernel-conversation-log.service';
import { KernelLifecycleFeedbackService } from '@/modules/kernel/application/kernel-lifecycle-feedback.service';
import { KernelMessageFileContextService } from '@/modules/kernel/application/kernel-message-file-context.service';
import { KernelMessageRunCancellationService } from '@/modules/kernel/application/kernel-message-run-cancellation.service';
import { KernelMessageRunIntakeService } from '@/modules/kernel/application/kernel-message-run-intake.service';
import { KernelMessageRunnerService } from '@/modules/kernel/application/kernel-message-runner.service';
import { KernelSessionAccessService } from '@/modules/kernel/application/kernel-session-access.service';
import { KernelSessionBroadcaster } from '@/modules/kernel/application/kernel-session-broadcaster.service';
import { KernelSessionConnectionService } from '@/modules/kernel/application/kernel-session-connection.service';
import { KernelSessionResetService } from '@/modules/kernel/application/kernel-session-reset.service';
import { KernelSessionRuntimeAccessService } from '@/modules/kernel/application/kernel-session-runtime-access.service';
import { KernelSessionRuntimeFactory } from '@/modules/kernel/application/kernel-session-runtime-factory.service';
import { KernelSessionRuntimeStateService } from '@/modules/kernel/application/kernel-session-runtime-state.service';
import { KernelSessionSnapshotService } from '@/modules/kernel/application/kernel-session-snapshot.service';
import { KernelSessionStatusService } from '@/modules/kernel/application/kernel-session-status.service';
import { KernelToolConfirmationService } from '@/modules/kernel/application/kernel-tool-confirmation.service';
import { CountSessionsHandler } from '@/modules/kernel/application/queries/count-sessions';
import { GetSessionHandler } from '@/modules/kernel/application/queries/get-session';
import { GetSessionMessagesHandler } from '@/modules/kernel/application/queries/get-session-messages';
import { ListSessionsHandler } from '@/modules/kernel/application/queries/list-sessions';
import { SessionService } from '@/modules/kernel/application/session.service';
import { SessionWorkspaceFileUploadService } from '@/modules/kernel/application/session-workspace-file-upload.service';
import { SessionWorkspaceSeedService } from '@/modules/kernel/application/session-workspace-seed.service';
import { WorkspaceGitService } from '@/modules/kernel/application/workspace-git.service';
import { WorkspaceOcrService } from '@/modules/kernel/application/workspace-ocr.service';
import { WorkspaceUploadService } from '@/modules/kernel/application/workspace-upload.service';
import { MESSAGE_REPOSITORY } from '@/modules/kernel/domain/repositories/message.repository.interface';
import { SESSION_REPOSITORY } from '@/modules/kernel/domain/repositories/session.repository.interface';
import {
    DESKTOP_MODEL_CONFIG_SYNC,
    type IDesktopModelConfigSync,
} from '@/modules/config/domain/services/desktop-model-config-sync.interface';
import { AGENT_SPEC, type AgentSpec } from '@/modules/kernel/domain/services/agent-spec.interface';
import { KERNEL_MESSAGE_RUN_SERVICE } from '@/modules/kernel/domain/services/kernel-message-run.service.interface';
import { KERNEL_RUNTIME_CONFIG_SERVICE } from '@/modules/kernel/domain/services/kernel-runtime-config.service.interface';
import { KERNEL_SERVICE } from '@/modules/kernel/domain/services/kernel-service.interface';
import { WORKSPACE_STORAGE } from '@/modules/kernel/domain/services/workspace-storage.interface';
import { DesktopKernelRuntimeConfigService } from '@/modules/kernel/infrastructure/desktop/desktop-kernel-runtime-config.service';
import { DesktopOpenKernelController } from '@/modules/kernel/presentation/controllers/desktop-open-kernel.controller';
import { KernelController } from '@/modules/kernel/presentation/controllers/kernel.controller';
import { KernelRuntimeAdminController } from '@/modules/kernel/presentation/controllers/kernel-runtime-admin.controller';
import { KernelSessionRuntimeController } from '@/modules/kernel/presentation/controllers/kernel-session-runtime.controller';
import { KernelSessionRuntimeInspectionController } from '@/modules/kernel/presentation/controllers/kernel-session-runtime-inspection.controller';
import { KernelSessionWorkspaceController } from '@/modules/kernel/presentation/controllers/kernel-session-workspace.controller';
import { WorkspaceController } from '@/modules/kernel/presentation/controllers/workspace.controller';
import { KernelGateway } from '@/modules/kernel/presentation/gateways/kernel.gateway';
import { DesktopAssetsRuntimeModule } from './desktop-assets-runtime.module';
import { DesktopConfigRuntimeModule } from './desktop-config-runtime.module';

const CommandHandlers = [CreateSessionHandler, EndSessionHandler];
const QueryHandlers = [GetSessionHandler, ListSessionsHandler, CountSessionsHandler, GetSessionMessagesHandler];
const DESKTOP_MODEL_CONFIG_INVALIDATION_BRIDGE = Symbol('DESKTOP_MODEL_CONFIG_INVALIDATION_BRIDGE');

@Module({
    imports: [
        CqrsModule,
        HttpModule,
        DesktopAssetsRuntimeModule,
        DesktopConfigRuntimeModule,
        AppConfigModule,
    ],
    controllers: [
        KernelController,
        KernelSessionWorkspaceController,
        KernelSessionRuntimeController,
        KernelSessionRuntimeInspectionController,
        KernelRuntimeAdminController,
        WorkspaceController,
        DesktopOpenKernelController,
    ],
    providers: [
        ...CommandHandlers,
        ...QueryHandlers,
        DesktopSessionRepository,
        DesktopMessageRepository,
        {
            provide: SESSION_REPOSITORY,
            useExisting: DesktopSessionRepository,
        },
        {
            provide: MESSAGE_REPOSITORY,
            useExisting: DesktopMessageRepository,
        },
        {
            provide: KERNEL_SERVICE,
            useClass: DesktopKernelService,
        },
        DesktopKernelRuntimeConfigService,
        {
            provide: KERNEL_RUNTIME_CONFIG_SERVICE,
            useExisting: DesktopKernelRuntimeConfigService,
        },
        {
            provide: WORKSPACE_STORAGE,
            useFactory: () => new LocalFileStorage(),
        },
        KernelGateway,
        KernelBtwQueryService,
        KernelConversationLogService,
        KernelLifecycleFeedbackService,
        KernelMessageFileContextService,
        KernelMessageRunCancellationService,
        KernelMessageRunIntakeService,
        {
            provide: KERNEL_MESSAGE_RUN_SERVICE,
            useExisting: KernelMessageRunIntakeService,
        },
        KernelMessageRunnerService,
        KernelSessionAccessService,
        AgentRegistry,
        AgentLifecycleMediator,
        LockedAgentSessionStore,
        DefaultAgent,
        AssetAgent,
        {
            provide: AGENT_SPEC,
            useFactory: (...agents: AgentSpec[]) => agents,
            inject: [DefaultAgent, AssetAgent],
        },
        KernelSessionResetService,
        KernelSessionBroadcaster,
        KernelSessionConnectionService,
        KernelSessionRuntimeAccessService,
        KernelSessionRuntimeFactory,
        KernelSessionRuntimeStateService,
        {
            provide: DESKTOP_MODEL_CONFIG_INVALIDATION_BRIDGE,
            useFactory: (
                modelConfigSync: IDesktopModelConfigSync,
                runtimeState: KernelSessionRuntimeStateService,
            ) => {
                modelConfigSync.registerInvalidator((reason = 'llm-settings-sync') =>
                    runtimeState.invalidateModelsConfig(reason),
                );
                return true;
            },
            inject: [DESKTOP_MODEL_CONFIG_SYNC, KernelSessionRuntimeStateService],
        },
        KernelSessionSnapshotService,
        KernelSessionStatusService,
        KernelToolConfirmationService,
        ApiOperationExecutor,
        CapabilitiesToolService,
        SessionService,
        SessionWorkspaceSeedService,
        SessionWorkspaceFileUploadService,
        WorkspaceGitService,
        WorkspaceOcrService,
        WorkspaceUploadService,
    ],
    exports: [
        KERNEL_SERVICE,
        KERNEL_MESSAGE_RUN_SERVICE,
        KERNEL_RUNTIME_CONFIG_SERVICE,
        WORKSPACE_STORAGE,
        CapabilitiesToolService,
        AgentRegistry,
        SessionService,
        SessionWorkspaceSeedService,
        KernelBtwQueryService,
        KernelMessageRunIntakeService,
        KernelMessageRunCancellationService,
        KernelSessionAccessService,
        KernelSessionResetService,
        KernelSessionBroadcaster,
        KernelSessionSnapshotService,
        KernelSessionStatusService,
        KernelSessionRuntimeAccessService,
        KernelSessionRuntimeStateService,
        SessionWorkspaceFileUploadService,
        WorkspaceGitService,
    ],
})
export class DesktopKernelRuntimeModule {}
