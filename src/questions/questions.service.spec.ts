import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { QuestionsService } from './questions.service';
import { EmbeddingsService, EMBEDDING_DIMENSIONS } from '../embeddings/embeddings.service';
import { DocumentsService } from '../documents/documents.service';
import { RetrievalService, RetrievedChunk } from './retrieval.service';
import { ClaudeService } from './claude.service';
import { Question } from './entities/question.entity';

function makeConfig(topK = 5): ConfigService {
  return {
    get: <T>(_key: string, fallback: T): T => String(topK) as unknown as T,
  } as unknown as ConfigService;
}

function makeChunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: 'c1',
    chunkIndex: 1,
    pageNumber: 2,
    content: 'Supervised learning uses labelled data to train a model.',
    distance: 0.1,
    ...overrides,
  };
}

interface RepoMock {
  create: jest.Mock;
  save: jest.Mock;
  find: jest.Mock;
}

describe('QuestionsService', () => {
  let service: QuestionsService;
  let questionsRepo: RepoMock;
  let embeddings: { embed: jest.Mock; formatForPgVector: jest.Mock };
  let documents: { assertExists: jest.Mock };
  let retrieval: { retrieveTopK: jest.Mock };
  let claude: { generateGroundedAnswer: jest.Mock; evaluateGrounding: jest.Mock };

  beforeEach(() => {
    questionsRepo = {
      create: jest.fn((x?: unknown) => x),
      save: jest.fn((x: unknown) => Promise.resolve(x)),
      find: jest.fn(),
    };
    embeddings = {
      embed: jest.fn().mockResolvedValue(new Array(EMBEDDING_DIMENSIONS).fill(0.01)),
      formatForPgVector: jest.fn().mockReturnValue('[0.01,...]'),
    };
    documents = { assertExists: jest.fn().mockResolvedValue(undefined) };
    retrieval = { retrieveTopK: jest.fn() };
    claude = {
      generateGroundedAnswer: jest.fn(),
      evaluateGrounding: jest.fn(),
    };
    service = new QuestionsService(
      questionsRepo as unknown as Repository<Question>,
      embeddings as unknown as EmbeddingsService,
      documents as unknown as DocumentsService,
      retrieval as unknown as RetrievalService,
      claude as unknown as ClaudeService,
      makeConfig(5),
    );
  });

  it('runs the full pipeline: assert → embed → retrieve → answer → evaluate → persist', async () => {
    retrieval.retrieveTopK.mockResolvedValue([makeChunk()]);
    claude.generateGroundedAnswer.mockResolvedValue('Supervised uses labels. [Chunk 1, Page 2]');
    claude.evaluateGrounding.mockResolvedValue({
      isGrounded: true,
      confidence: 0.91,
      unsupportedClaims: [],
      reasoning: 'All claims grounded',
    });

    const result = await service.ask({
      documentId: 'doc-1',
      question: 'What is supervised learning?',
    });

    expect(documents.assertExists).toHaveBeenCalledWith('doc-1');
    expect(embeddings.embed).toHaveBeenCalledWith('What is supervised learning?');
    expect(retrieval.retrieveTopK).toHaveBeenCalledWith('doc-1', '[0.01,...]', 5);
    expect(claude.generateGroundedAnswer).toHaveBeenCalled();
    expect(claude.evaluateGrounding).toHaveBeenCalled();
    expect(questionsRepo.save).toHaveBeenCalled();
    expect(result.isGrounded).toBe(true);
    expect(result.groundingConfidence).toBeCloseTo(0.91);
    expect(result.sourcesUsed).toHaveLength(1);
    expect(result.retrievedChunkCount).toBe(1);
  });

  it('uses the topK override when supplied', async () => {
    retrieval.retrieveTopK.mockResolvedValue([makeChunk()]);
    claude.generateGroundedAnswer.mockResolvedValue('a');
    claude.evaluateGrounding.mockResolvedValue({
      isGrounded: true,
      confidence: 1,
      unsupportedClaims: [],
      reasoning: '',
    });
    await service.ask({ documentId: 'doc-1', question: 'q', topK: 12 });
    expect(retrieval.retrieveTopK).toHaveBeenCalledWith('doc-1', expect.any(String), 12);
  });

  it('short-circuits to a refusal when no chunks are retrieved (skips Claude calls)', async () => {
    retrieval.retrieveTopK.mockResolvedValue([]);
    const result = await service.ask({ documentId: 'doc-1', question: 'x' });
    expect(claude.generateGroundedAnswer).not.toHaveBeenCalled();
    expect(claude.evaluateGrounding).not.toHaveBeenCalled();
    expect(result.isGrounded).toBe(false);
    expect(result.answer).toMatch(/cannot answer/i);
    expect(result.sourcesUsed).toEqual([]);
    expect(questionsRepo.save).toHaveBeenCalled();
  });

  it('propagates 404 from DocumentsService.assertExists', async () => {
    documents.assertExists.mockRejectedValue(new NotFoundException('Document doc-1 not found'));
    await expect(
      service.ask({ documentId: 'doc-1', question: 'q' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(embeddings.embed).not.toHaveBeenCalled();
  });

  it('truncates long chunk content in the sourcesUsed preview', async () => {
    const longContent = 'A'.repeat(500);
    retrieval.retrieveTopK.mockResolvedValue([makeChunk({ content: longContent })]);
    claude.generateGroundedAnswer.mockResolvedValue('a');
    claude.evaluateGrounding.mockResolvedValue({
      isGrounded: true,
      confidence: 1,
      unsupportedClaims: [],
      reasoning: '',
    });
    const result = await service.ask({ documentId: 'doc-1', question: 'q' });
    expect(result.sourcesUsed[0].contentPreview.length).toBeLessThan(longContent.length);
    expect(result.sourcesUsed[0].contentPreview.endsWith('...')).toBe(true);
  });

  describe('history', () => {
    it('returns recent Q&A items for a document', async () => {
      questionsRepo.find.mockResolvedValue([
        {
          id: 'q1',
          documentId: 'doc-1',
          question: 'Q?',
          answer: 'A',
          isGrounded: true,
          groundingConfidence: 0.9,
          unsupportedClaims: [],
          sourcesUsed: [],
          processingTimeMs: 100,
          createdAt: new Date('2026-06-20T00:00:00.000Z'),
        } as unknown as Question,
      ]);
      const result = await service.history('doc-1');
      expect(result).toHaveLength(1);
      expect(result[0].createdAt).toBe('2026-06-20T00:00:00.000Z');
      expect(documents.assertExists).toHaveBeenCalledWith('doc-1');
    });

    it('throws 404 when the document is missing', async () => {
      documents.assertExists.mockRejectedValue(new NotFoundException('Document missing'));
      await expect(service.history('doc-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
