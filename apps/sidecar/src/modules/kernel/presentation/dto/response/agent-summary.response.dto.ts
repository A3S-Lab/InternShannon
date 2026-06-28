import { ApiProperty } from '@nestjs/swagger';

export class AgentSummaryResponseDto {
    @ApiProperty({ description: '智能体 ID', example: 'default' })
    id: string;

    @ApiProperty({ description: '智能体展示名称', example: 'internShannon' })
    name: string;

    @ApiProperty({ description: '智能体能力介绍' })
    description: string;
}
