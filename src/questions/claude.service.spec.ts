import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { ClaudeService } from './claude.service';
import { RetrievedChunk } from './retrieval.service';

const createMock = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  const ctor = jest.fn().mockImplementation(() => ({
    messages: { create: createMock },
  }));
  return { __esModule: true, default: ctor };
});

function makeConfig(): ConfigService {
  const values: Record<string, string> = {
    ANTHROPIC_API_KEY: 'test',
    ANTHROPIC_MODEL: 'claude-sonnet-4-6',
  };
  return {
    getOrThrow: <T>(key: string): T => values[key] as unknown as T,
    get: <T>(key: string, fallback?: T): T => (values[key] as unknown as T) ?? (fallback as T),
  } as unknown as ConfigService;
}

const chunks: RetrievedChunk[] = [
  { id: 'c1', chunkIndex: 1, pageNumber: 3, content: 'Supervised learning uses labels.', distance: 0.1 },
  { id: 'c2', chunkIndex: 2, pageNumber: 4, content: 'Unsupervised learning finds structure.', distance: 0.2 },
];

describe('ClaudeService', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('generates a grounded answer by sending context + question to Claude', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Supervised uses labels. [Chunk 1, Page 3]' }],
    });
    const svc = new ClaudeService(makeConfig());
    const answer = await svc.generateGroundedAnswer('What is supervised learning?', chunks);
    expect(answer).toContain('[Chunk 1, Page 3]');
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
        system: expect.stringContaining('precise academic tutor'),
        messages: [
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('Supervised learning uses labels'),
          }),
        ],
      }),
    );
  });

  it('parses a clean JSON evaluation', async () => {
    createMock.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: '{"isGrounded": true, "confidence": 0.93, "unsupportedClaims": [], "reasoning": "ok"}',
        },
      ],
    });
    const svc = new ClaudeService(makeConfig());
    const result = await svc.evaluateGrounding('answer', chunks);
    expect(result.isGrounded).toBe(true);
    expect(result.confidence).toBeCloseTo(0.93);
    expect(result.unsupportedClaims).toEqual([]);
    expect(result.reasoning).toBe('ok');
  });

  it('strips markdown code fences from the evaluation JSON', async () => {
    createMock.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: '```json\n{"isGrounded": false, "confidence": 0.4, "unsupportedClaims": ["x"], "reasoning": "weak"}\n```',
        },
      ],
    });
    const svc = new ClaudeService(makeConfig());
    const result = await svc.evaluateGrounding('answer', chunks);
    expect(result.isGrounded).toBe(false);
    expect(result.unsupportedClaims).toEqual(['x']);
  });

  it('clamps confidence to [0, 1] and tolerates surrounding prose', async () => {
    createMock.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: 'Sure, here you go:\n{"isGrounded": true, "confidence": 2.5, "unsupportedClaims": [], "reasoning": "ok"}\nthanks!',
        },
      ],
    });
    const svc = new ClaudeService(makeConfig());
    const result = await svc.evaluateGrounding('answer', chunks);
    expect(result.confidence).toBe(1);
  });

  it('returns a safe fallback when Claude returns malformed JSON', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not even close to JSON' }],
    });
    const svc = new ClaudeService(makeConfig());
    const result = await svc.evaluateGrounding('answer', chunks);
    expect(result.isGrounded).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it('wraps Claude API failures as BAD_GATEWAY HttpException', async () => {
    createMock.mockRejectedValueOnce(new Error('upstream down'));
    const svc = new ClaudeService(makeConfig());
    await expect(svc.generateGroundedAnswer('q', chunks)).rejects.toBeInstanceOf(HttpException);
  });
});
