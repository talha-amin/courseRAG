import { NotFoundException } from '@nestjs/common';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { AskQuestionDto } from './dto/ask-question.dto';
import { AnswerResponseDto } from './dto/question-response.dto';

function makeAnswer(overrides: Partial<AnswerResponseDto> = {}): AnswerResponseDto {
  return {
    answer: 'Supervised learning uses labelled training data. [Chunk 3, Page 7]',
    isGrounded: true,
    groundingConfidence: 0.94,
    unsupportedClaims: [],
    groundingReasoning: 'All claims directly reference retrieved passages.',
    sourcesUsed: [
      { chunkIndex: 3, pageNumber: 7, contentPreview: 'Supervised learning is defined...' },
    ],
    retrievedChunkCount: 5,
    processingTimeMs: 1840,
    ...overrides,
  };
}

describe('QuestionsController', () => {
  let controller: QuestionsController;
  let service: jest.Mocked<QuestionsService>;

  beforeEach(() => {
    service = {
      ask: jest.fn(),
      history: jest.fn(),
    } as unknown as jest.Mocked<QuestionsService>;
    controller = new QuestionsController(service);
  });

  describe('POST /questions/ask', () => {
    it('returns a 200 answer with grounding metadata for a valid document', async () => {
      const expected = makeAnswer();
      service.ask.mockResolvedValue(expected);
      const dto: AskQuestionDto = {
        documentId: '5d8c0a3a-7c8c-4c19-b1b1-1234567890ab',
        question: 'What is supervised learning?',
        topK: 5,
      };
      const result = await controller.ask(dto);
      expect(result.answer).toBe(expected.answer);
      expect(result.isGrounded).toBe(true);
      expect(result.groundingConfidence).toBeCloseTo(0.94);
      expect(result.sourcesUsed).toHaveLength(1);
      expect(service.ask).toHaveBeenCalledWith(dto);
    });

    it('passes through 404 when the document does not exist', async () => {
      service.ask.mockRejectedValue(new NotFoundException('Document not found'));
      const dto: AskQuestionDto = {
        documentId: '5d8c0a3a-7c8c-4c19-b1b1-1234567890ab',
        question: 'Any?',
      };
      await expect(controller.ask(dto)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns an ungrounded answer when no chunks match', async () => {
      service.ask.mockResolvedValue(
        makeAnswer({
          answer:
            'I cannot answer this question based on the provided course material. The relevant information may be on a different section not yet uploaded.',
          isGrounded: false,
          groundingConfidence: 0,
          sourcesUsed: [],
          retrievedChunkCount: 0,
        }),
      );
      const dto: AskQuestionDto = {
        documentId: '5d8c0a3a-7c8c-4c19-b1b1-1234567890ab',
        question: 'Anything off-topic?',
      };
      const result = await controller.ask(dto);
      expect(result.isGrounded).toBe(false);
      expect(result.sourcesUsed).toHaveLength(0);
    });
  });

  describe('GET /questions/history/:documentId', () => {
    it('returns history items', async () => {
      service.history.mockResolvedValue([
        {
          id: 'q1',
          question: 'Q1?',
          answer: 'A1',
          isGrounded: true,
          groundingConfidence: 0.9,
          unsupportedClaims: [],
          sourcesUsed: [],
          processingTimeMs: 1500,
          createdAt: '2026-06-20T00:00:00.000Z',
        },
      ]);
      const result = await controller.history('5d8c0a3a-7c8c-4c19-b1b1-1234567890ab');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('q1');
    });

    it('passes through 404 when document missing', async () => {
      service.history.mockRejectedValue(new NotFoundException('missing'));
      await expect(
        controller.history('5d8c0a3a-7c8c-4c19-b1b1-1234567890ab'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
