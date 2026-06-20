import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { validateEnv } from './config/env.validation';
import { Document } from './documents/entities/document.entity';
import { Chunk } from './documents/entities/chunk.entity';
import { Question } from './questions/entities/question.entity';
import { DocumentsModule } from './documents/documents.module';
import { QuestionsModule } from './questions/questions.module';
import { EmbeddingsModule } from './embeddings/embeddings.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<string>('DATABASE_URL'),
        ssl: config.get<string>('DATABASE_SSL') === 'true' ? { rejectUnauthorized: false } : false,
        entities: [Document, Chunk, Question],
        synchronize: config.get<string>('DATABASE_SYNC') === 'true' || config.get<string>('NODE_ENV') !== 'production',
        autoLoadEntities: true,
      }),
    }),
    EmbeddingsModule,
    DocumentsModule,
    QuestionsModule,
    HealthModule,
  ],
})
export class AppModule {}
