import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export const EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_BATCH_SIZE = 64;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.getOrThrow<string>('OPENAI_API_KEY');
    this.client = new OpenAI({ apiKey });
    this.model = this.config.get<string>('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small');
  }

  async embed(text: string): Promise<number[]> {
    const [vector] = await this.embedBatch([text]);
    return vector;
  }

  async embedBatch(texts: string[], batchSize: number = DEFAULT_BATCH_SIZE): Promise<number[][]> {
    if (texts.length === 0) return [];
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const vectors = await this.embedBatchWithRetry(batch);
      results.push(...vectors);
    }
    return results;
  }

  private async embedBatchWithRetry(batch: string[]): Promise<number[][]> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.embeddings.create({
          model: this.model,
          input: batch,
        });
        const vectors = response.data
          .sort((a, b) => a.index - b.index)
          .map((d) => d.embedding);
        for (const vector of vectors) {
          if (vector.length !== EMBEDDING_DIMENSIONS) {
            throw new Error(
              `Unexpected embedding dimension ${vector.length}, expected ${EMBEDDING_DIMENSIONS}`,
            );
          }
        }
        return vectors;
      } catch (err) {
        lastError = err;
        const isRateLimit = this.isRetryable(err);
        this.logger.warn(
          `Embedding attempt ${attempt}/${MAX_RETRIES} failed${isRateLimit ? ' (retryable)' : ''}: ${this.errorMessage(err)}`,
        );
        if (!isRateLimit || attempt === MAX_RETRIES) break;
        await this.sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
      }
    }
    throw new HttpException(
      `OpenAI embedding request failed after ${MAX_RETRIES} attempts: ${this.errorMessage(lastError)}`,
      HttpStatus.BAD_GATEWAY,
    );
  }

  formatForPgVector(vector: number[]): string {
    return `[${vector.join(',')}]`;
  }

  private isRetryable(err: unknown): boolean {
    if (err instanceof OpenAI.APIError) {
      return err.status === 429 || (err.status !== undefined && err.status >= 500);
    }
    return false;
  }

  private errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
