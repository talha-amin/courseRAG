import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Document } from './entities/document.entity';
import { Chunk } from './entities/chunk.entity';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { ChunkingService } from './chunking.service';
import { PdfParserService } from './pdf-parser.service';
import { EmbeddingsModule } from '../embeddings/embeddings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Document, Chunk]),
    EmbeddingsModule,
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        storage: memoryStorage(),
        limits: {
          fileSize: Number(config.get<string>('MAX_FILE_SIZE_MB', '10')) * 1024 * 1024,
        },
      }),
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, ChunkingService, PdfParserService],
  exports: [DocumentsService, ChunkingService],
})
export class DocumentsModule {}
