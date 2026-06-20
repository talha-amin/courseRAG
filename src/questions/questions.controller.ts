import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AskQuestionDto } from './dto/ask-question.dto';
import {
  AnswerResponseDto,
  QuestionHistoryItemDto,
} from './dto/question-response.dto';
import { QuestionsService } from './questions.service';

@ApiTags('questions')
@Controller('questions')
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Post('ask')
  @ApiOperation({
    summary: 'Ask a grounded question against a document',
    description:
      'Embeds the question, retrieves the top-K most similar chunks via pgvector cosine distance, asks Claude to answer using ONLY those passages, then runs a second Claude pass to fact-check the answer against the same passages.',
  })
  @ApiResponse({ status: 200, type: AnswerResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  @ApiResponse({ status: 502, description: 'OpenAI or Claude API failure' })
  async ask(@Body() dto: AskQuestionDto): Promise<AnswerResponseDto> {
    return this.questionsService.ask(dto);
  }

  @Get('history/:documentId')
  @ApiOperation({ summary: 'Get recent Q&A history for a document (last 20)' })
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiResponse({ status: 200, type: [QuestionHistoryItemDto] })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async history(
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<QuestionHistoryItemDto[]> {
    return this.questionsService.history(documentId);
  }
}
