import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Chunk } from '../documents/entities/chunk.entity';

export interface RetrievedChunk {
  id: string;
  chunkIndex: number;
  pageNumber: number;
  content: string;
  distance: number;
}

@Injectable()
export class RetrievalService {
  constructor(@InjectRepository(Chunk) private readonly chunks: Repository<Chunk>) {}

  async retrieveTopK(
    documentId: string,
    queryEmbedding: string,
    topK: number,
  ): Promise<RetrievedChunk[]> {
    // pgvector cosine distance operator is `<=>`. Smaller distance = more similar.
    const rows = await this.chunks
      .createQueryBuilder('chunk')
      .select([
        'chunk.id AS id',
        'chunk.chunk_index AS "chunkIndex"',
        'chunk.page_number AS "pageNumber"',
        'chunk.content AS content',
        '(chunk.embedding::vector <=> :queryEmbedding::vector) AS distance',
      ])
      .where('chunk.document_id = :documentId', { documentId })
      .andWhere('chunk.embedding IS NOT NULL')
      .orderBy('distance', 'ASC')
      .setParameter('queryEmbedding', queryEmbedding)
      .limit(topK)
      .getRawMany<{
        id: string;
        chunkIndex: number;
        pageNumber: number;
        content: string;
        distance: string;
      }>();

    return rows.map((row) => ({
      id: row.id,
      chunkIndex: Number(row.chunkIndex),
      pageNumber: Number(row.pageNumber),
      content: row.content,
      distance: Number(row.distance),
    }));
  }
}
