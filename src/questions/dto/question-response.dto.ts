import { ApiProperty } from '@nestjs/swagger';

export class SourceUsedDto {
  @ApiProperty({ example: 3 })
  chunkIndex!: number;

  @ApiProperty({ example: 7 })
  pageNumber!: number;

  @ApiProperty({
    example: 'Supervised learning is defined as the task of learning a function that maps...',
  })
  contentPreview!: string;
}

export class AnswerResponseDto {
  @ApiProperty({
    example:
      'Supervised learning uses labelled training data, whereas unsupervised learning... [Chunk 3, Page 7]',
  })
  answer!: string;

  @ApiProperty({ example: true })
  isGrounded!: boolean;

  @ApiProperty({ example: 0.94, minimum: 0, maximum: 1 })
  groundingConfidence!: number;

  @ApiProperty({ type: [String], example: [] })
  unsupportedClaims!: string[];

  @ApiProperty({ example: 'All claims directly reference retrieved passages.' })
  groundingReasoning!: string;

  @ApiProperty({ type: [SourceUsedDto] })
  sourcesUsed!: SourceUsedDto[];

  @ApiProperty({ example: 5 })
  retrievedChunkCount!: number;

  @ApiProperty({ example: 1840 })
  processingTimeMs!: number;
}

export class QuestionHistoryItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  question!: string;

  @ApiProperty()
  answer!: string;

  @ApiProperty()
  isGrounded!: boolean;

  @ApiProperty()
  groundingConfidence!: number;

  @ApiProperty({ type: [String] })
  unsupportedClaims!: string[];

  @ApiProperty({ type: [SourceUsedDto] })
  sourcesUsed!: SourceUsedDto[];

  @ApiProperty()
  processingTimeMs!: number;

  @ApiProperty()
  createdAt!: string;
}
