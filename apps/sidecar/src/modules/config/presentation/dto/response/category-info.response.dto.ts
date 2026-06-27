import { ApiProperty } from '@nestjs/swagger';

export class CategoryInfoResponseDto {
    @ApiProperty({ description: '分类名称', example: 'llm' })
    name!: string;

    @ApiProperty({ description: '分类描述', example: 'LLM 配置' })
    description!: string;
}

export class CategoryListResponseDto {
    @ApiProperty({ description: '分类列表', type: [CategoryInfoResponseDto] })
    items!: CategoryInfoResponseDto[];
}
