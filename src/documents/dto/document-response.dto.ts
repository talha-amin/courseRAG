import { ApiProperty } from '@nestjs/swagger';

export class UploadDocumentResponseDto {
  @ApiProperty({ example: '5d8c0a3a-7c8c-4c19-b1b1-1234567890ab', format: 'uuid' })
  documentId!: string;

  @ApiProperty({ example: 'lecture-notes.pdf' })
  filename!: string;

  @ApiProperty({ example: 12, description: 'Number of pages parsed from the PDF' })
  pageCount!: number;

  @ApiProperty({ example: 47, description: 'Number of chunks produced and embedded' })
  chunkCount!: number;

  @ApiProperty({ example: 3420, description: 'End-to-end processing time in milliseconds' })
  processingTimeMs!: number;
}

export class DocumentSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'lecture-notes.pdf' })
  filename!: string;

  @ApiProperty({ example: 'CS229 Lecture 3 - Logistic Regression.pdf' })
  originalName!: string;

  @ApiProperty({ example: 12 })
  pageCount!: number;

  @ApiProperty({ example: 47 })
  chunkCount!: number;

  @ApiProperty({ example: '2026-06-20T14:32:11.000Z' })
  createdAt!: string;
}
