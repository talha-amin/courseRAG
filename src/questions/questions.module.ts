import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Question } from './entities/question.entity';
import { Chunk } from '../documents/entities/chunk.entity';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { RetrievalService } from './retrieval.service';
import { ClaudeService } from './claude.service';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [TypeOrmModule.forFeature([Question, Chunk]), EmbeddingsModule, DocumentsModule],
  controllers: [QuestionsController],
  providers: [QuestionsService, RetrievalService, ClaudeService],
})
export class QuestionsModule {}
