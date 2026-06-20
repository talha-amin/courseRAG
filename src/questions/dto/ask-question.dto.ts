import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, Max, MinLength } from 'class-validator';

export class AskQuestionDto {
  @ApiProperty({
    format: 'uuid',
    example: '5d8c0a3a-7c8c-4c19-b1b1-1234567890ab',
    description: 'ID of the document to ground the answer in',
  })
  @IsUUID()
  documentId!: string;

  @ApiProperty({
    example: 'What is the difference between supervised and unsupervised learning?',
    minLength: 3,
    maxLength: 2000,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  question!: string;

  @ApiProperty({
    required: false,
    minimum: 1,
    maximum: 20,
    example: 5,
    description: 'How many top chunks to retrieve as grounding context (default 5).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  topK?: number;
}
