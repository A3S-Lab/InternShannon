import { Module, Global } from '@nestjs/common';
import { WorkflowEngine } from './engine';
import { IWorkflowRuntime, IWorkflowRepository } from './interfaces';

// Re-export all public APIs
export * from './domain';
export * from './engine';
export * from './interfaces';

export const WORKFLOW_ENGINE_TOKEN = 'WORKFLOW_ENGINE';
export const WORKFLOW_RUNTIME_TOKEN = 'WORKFLOW_RUNTIME';
export const WORKFLOW_REPOSITORY_TOKEN = 'WORKFLOW_REPOSITORY';

@Global()
@Module({})
export class WorkflowModule {
    /**
     * Register custom runtime and repository implementation together
     * This ensures WORKFLOW_ENGINE factory has both dependencies available
     */
    static forRuntimeAndRepository = <T extends IWorkflowRuntime, R extends IWorkflowRepository>(
        runtime: T,
        repository: R,
    ) => ({
        module: WorkflowModule,
        providers: [
            { provide: WORKFLOW_RUNTIME_TOKEN, useValue: runtime },
            { provide: WORKFLOW_REPOSITORY_TOKEN, useValue: repository },
            {
                provide: WORKFLOW_ENGINE_TOKEN,
                useFactory: (r: T, repo: R) => new WorkflowEngine(r, repo),
                inject: [WORKFLOW_RUNTIME_TOKEN, WORKFLOW_REPOSITORY_TOKEN],
            },
        ],
        exports: [WORKFLOW_ENGINE_TOKEN, WORKFLOW_RUNTIME_TOKEN, WORKFLOW_REPOSITORY_TOKEN],
    });
}
