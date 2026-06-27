import { Global, Module } from '@nestjs/common';
import { LoopControllerRegistry } from './application/loop-controller-registry';
import { LoopSpecRegistry } from './application/loop-spec-registry';
import { DiagnoseRunnerRegistry } from './loops/dev/diagnose-runner-registry';

/**
 * @Global so any feature module's LoopController can inject the registries and self-register, and the
 * driver / spec controller (LoopModule) can read them — without cross-module imports.
 *
 * - LoopControllerRegistry: drives runtime (the LoopRunDriver pulls controllers by kind).
 * - LoopSpecRegistry: read-only 循环工程建模 models (the /loops/specs endpoint reads them).
 * - DiagnoseRunnerRegistry: seam the BuiltinAssetsBootstrap registers AssetDiagnoseRunner into so the
 *   dev:diagnose LoopController can delegate to it without importing the runner (no import cycle).
 */
@Global()
@Module({
    providers: [LoopControllerRegistry, LoopSpecRegistry, DiagnoseRunnerRegistry],
    exports: [LoopControllerRegistry, LoopSpecRegistry, DiagnoseRunnerRegistry],
})
export class LoopRegistryModule {}
