import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Question } from './entities/question.entity';
import { AskQuestionDto } from './dto/ask-question.dto';
import {
  AnswerResponseDto,
  QuestionHistoryItemDto,
  SourceUsedDto,
} from './dto/question-response.dto';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { DocumentsService } from '../documents/documents.service';
import { RetrievalService, RetrievedChunk } from './retrieval.service';
import { ClaudeService } from './claude.service';

const CONTENT_PREVIEW_CHARS = 160;
const HISTORY_LIMIT = 20;

@Injectable()
export class QuestionsService {
  private readonly logger = new Logger(QuestionsService.name);
  private readonly defaultTopK: number;

  constructor(
    @InjectRepository(Question) private readonly questions: Repository<Question>,
    private readonly embeddings: EmbeddingsService,
    private readonly documents: DocumentsService,
    private readonly retrieval: RetrievalService,
    private readonly claude: ClaudeService,
    config: ConfigService,
  ) {
    this.defaultTopK = Number(config.get<string>('DEFAULT_TOP_K', '5'));
  }

  async ask(dto: AskQuestionDto): Promise<AnswerResponseDto> {
    const started = Date.now();
    await this.documents.assertExists(dto.documentId);

    const topK = dto.topK ?? this.defaultTopK;
    const questionEmbedding = await this.embeddings.embed(dto.question);
    const queryVector = this.embeddings.formatForPgVector(questionEmbedding);
    const retrieved = await this.retrieval.retrieveTopK(dto.documentId, queryVector, topK);

    if (retrieved.length === 0) {
      const empty = this.buildEmptyAnswer(retrieved, Date.now() - started);
      await this.persistQuestion(dto, empty);
      return empty;
    }

    const answer = await this.claude.generateGroundedAnswer(dto.question, retrieved);
    const evaluation = await this.claude.evaluateGrounding(answer, retrieved);
    const processingTimeMs = Date.now() - started;

    const response: AnswerResponseDto = {
      answer,
      isGrounded: evaluation.isGrounded,
      groundingConfidence: evaluation.confidence,
      unsupportedClaims: evaluation.unsupportedClaims,
      groundingReasoning: evaluation.reasoning,
      sourcesUsed: retrieved.map((chunk) => this.toSource(chunk)),
      retrievedChunkCount: retrieved.length,
      processingTimeMs,
    };

    await this.persistQuestion(dto, response);
    this.logger.log(
      `Answered question on doc ${dto.documentId} in ${processingTimeMs}ms (grounded=${response.isGrounded}, confidence=${response.groundingConfidence})`,
    );
    return response;
  }

  async history(documentId: string): Promise<QuestionHistoryItemDto[]> {
    await this.documents.assertExists(documentId);
    const rows = await this.questions.find({
      where: { documentId },
      order: { createdAt: 'DESC' },
      take: HISTORY_LIMIT,
    });
    return rows.map((row) => ({
      id: row.id,
      question: row.question,
      answer: row.answer,
      isGrounded: row.isGrounded,
      groundingConfidence: row.groundingConfidence,
      unsupportedClaims: row.unsupportedClaims,
      sourcesUsed: row.sourcesUsed,
      processingTimeMs: row.processingTimeMs,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private buildEmptyAnswer(
    retrieved: RetrievedChunk[],
    processingTimeMs: number,
  ): AnswerResponseDto {
    return {
      answer:
        'I cannot answer this question based on the provided course material. The relevant information may be on a different section not yet uploaded.',
      isGrounded: false,
      groundingConfidence: 0,
      unsupportedClaims: [],
      groundingReasoning: 'No matching chunks were retrieved for this question.',
      sourcesUsed: [],
      retrievedChunkCount: retrieved.length,
      processingTimeMs,
    };
  }

  private toSource(chunk: RetrievedChunk): SourceUsedDto {
    return {
      chunkIndex: chunk.chunkIndex,
      pageNumber: chunk.pageNumber,
      contentPreview:
        chunk.content.length > CONTENT_PREVIEW_CHARS
          ? `${chunk.content.slice(0, CONTENT_PREVIEW_CHARS)}...`
          : chunk.content,
    };
  }

  private async persistQuestion(
    dto: AskQuestionDto,
    response: AnswerResponseDto,
  ): Promise<void> {
    const entity = this.questions.create({
      documentId: dto.documentId,
      question: dto.question,
      answer: response.answer,
      isGrounded: response.isGrounded,
      groundingConfidence: response.groundingConfidence,
      unsupportedClaims: response.unsupportedClaims,
      sourcesUsed: response.sourcesUsed,
      processingTimeMs: response.processingTimeMs,
    });
    await this.questions.save(entity);
  }
}
