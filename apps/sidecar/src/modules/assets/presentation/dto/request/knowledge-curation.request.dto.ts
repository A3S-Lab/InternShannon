import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import type { KnowledgeCurationDecision } from '../../../application/knowledge-curation.service';

export class UpdateKnowledgeCurationConfigRequestDto {
    @ApiPropertyOptional({
        description: 'Generate review-only curation suggestions after indexing',
    })
    @IsOptional()
    @IsBoolean()
    autoCuration?: boolean;
}

export class ReviewKnowledgeCurationSuggestionRequestDto {
    @ApiProperty({
        enum: ['accept', 'reject', 'revert'],
        description: 'Review decision',
    })
    @IsIn(['accept', 'reject', 'revert'])
    decision!: KnowledgeCurationDecision;
}
