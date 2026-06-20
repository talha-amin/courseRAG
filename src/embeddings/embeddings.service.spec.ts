import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';

const createMock = jest.fn();

jest.mock('openai', () => {
  class MockApiError extends Error {
    status: number | undefined;
    constructor(status: number | undefined, message: string) {
      super(message);
      this.status = status;
      this.name = 'APIError';
    }
  }
  const ctor = jest.fn().mockImplementation(() => ({
    embeddings: { create: createMock },
  }));
  return {
    __esModule: true,
    default: Object.assign(ctor, { APIError: MockApiError }),
    APIError: MockApiError,
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { APIError: MockApiError } = require('openai') as {
  APIError: new (status: number | undefined, message: string) => Error & { status?: number };
};

import { EMBEDDING_DIMENSIONS, EmbeddingsService } from './embeddings.service';

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    OPENAI_API_KEY: 'test-key',
    OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
    ...overrides,
  };
  return {
    getOrThrow: <T>(key: string): T => {
      if (!(key in values)) throw new Error(`Missing key ${key}`);
      return values[key] as unknown as T;
    },
    get: <T>(key: string, fallback?: T): T | undefined =>
      values[key] !== undefined ? (values[key] as unknown as T) : fallback,
  } as unknown as ConfigService;
}

function makeVector(seed: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i + seed) * 0.0001);
}

describe('EmbeddingsService', () => {
  beforeEach(() => {
    createMock.mockReset();
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('produces a 1536-dimensional embedding for a single string', async () => {
    createMock.mockResolvedValueOnce({
      data: [{ index: 0, embedding: makeVector(1) }],
    });
    const svc = new EmbeddingsService(makeConfig());
    const vector = await svc.embed('hello world');
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(createMock).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: ['hello world'],
    });
  });

  it('returns vectors in input order even if API responds out of order', async () => {
    createMock.mockResolvedValueOnce({
      data: [
        { index: 1, embedding: makeVector(2) },
        { index: 0, embedding: makeVector(1) },
      ],
    });
    const svc = new EmbeddingsService(makeConfig());
    const [first, second] = await svc.embedBatch(['a', 'b']);
    expect(first[0]).toBeCloseTo(makeVector(1)[0]);
    expect(second[0]).toBeCloseTo(makeVector(2)[0]);
  });

  it('returns an empty array for an empty batch without calling OpenAI', async () => {
    const svc = new EmbeddingsService(makeConfig());
    const result = await svc.embedBatch([]);
    expect(result).toEqual([]);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('splits large input into multiple batches', async () => {
    createMock.mockImplementation(({ input }: { input: string[] }) =>
      Promise.resolve({
        data: input.map((_, idx) => ({ index: idx, embedding: makeVector(idx) })),
      }),
    );
    const svc = new EmbeddingsService(makeConfig());
    const inputs = Array.from({ length: 150 }, (_, i) => `text ${i}`);
    const vectors = await svc.embedBatch(inputs);
    expect(vectors).toHaveLength(150);
    // Default batch size 64 -> 3 batches.
    expect(createMock).toHaveBeenCalledTimes(3);
  });

  it('retries on 429 then succeeds', async () => {
    const apiError = new MockApiError(429, 'rate');
    createMock
      .mockRejectedValueOnce(apiError)
      .mockResolvedValueOnce({ data: [{ index: 0, embedding: makeVector(0) }] });
    const svc = new EmbeddingsService(makeConfig());
    const promise = svc.embed('x');
    await jest.runOnlyPendingTimersAsync();
    const result = await promise;
    expect(result).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('retries on 5xx then succeeds', async () => {
    const apiError = new MockApiError(503, 'down');
    createMock
      .mockRejectedValueOnce(apiError)
      .mockResolvedValueOnce({ data: [{ index: 0, embedding: makeVector(0) }] });
    const svc = new EmbeddingsService(makeConfig());
    const promise = svc.embed('x');
    await jest.runOnlyPendingTimersAsync();
    const result = await promise;
    expect(result).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it('throws BAD_GATEWAY after retries are exhausted', async () => {
    const apiError = new MockApiError(429, 'rate');
    createMock.mockRejectedValue(apiError);
    const svc = new EmbeddingsService(makeConfig());
    const promise = svc.embed('x');
    const expectation = expect(promise).rejects.toBeInstanceOf(HttpException);
    await jest.runAllTimersAsync();
    await expectation;
    expect(createMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry on non-retryable errors', async () => {
    createMock.mockRejectedValueOnce(new Error('non-retryable'));
    const svc = new EmbeddingsService(makeConfig());
    await expect(svc.embed('x')).rejects.toBeInstanceOf(HttpException);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('throws when OpenAI returns a vector with the wrong dimension', async () => {
    createMock.mockResolvedValueOnce({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
    });
    const svc = new EmbeddingsService(makeConfig());
    await expect(svc.embed('x')).rejects.toBeInstanceOf(HttpException);
  });

  it('formatForPgVector produces a comma-separated bracketed string', () => {
    const svc = new EmbeddingsService(makeConfig());
    expect(svc.formatForPgVector([0.1, 0.2, 0.3])).toBe('[0.1,0.2,0.3]');
  });
});
