import { Module } from '@nestjs/common';
import { SerialChainPlannerService } from '@/modules/kernel/application/orchestration/serial-chain-planner/serial-chain-planner.service';

@Module({
    providers: [SerialChainPlannerService],
    exports: [SerialChainPlannerService],
})
export class DesktopSerialChainPlannerModule {}
