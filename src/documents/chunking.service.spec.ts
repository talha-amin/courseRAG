import { ConfigService } from '@nestjs/config';
import { ChunkingService } from './chunking.service';

function makeService(overrides: Record<string, string | number> = {}): ChunkingService {
  const config = {
    get: (key: string, fallback: unknown) => overrides[key] ?? fallback,
  } as unknown as ConfigService;
  return new ChunkingService(config);
}

describe('ChunkingService', () => {
  describe('estimateTokens', () => {
    it('returns 0 for empty input', () => {
      const svc = makeService();
      expect(svc.estimateTokens('')).toBe(0);
    });

    it('estimates tokens at roughly 1.3 per word', () => {
      const svc = makeService();
      const result = svc.estimateTokens('one two three four five');
      // 5 words * 1.3 = 6.5 -> ceil = 7
      expect(result).toBe(7);
    });
  });

  describe('chunk', () => {
    it('returns a single chunk for short text', () => {
      const svc = makeService();
      const text = 'This is a short course note covering a single idea for the student to read.';
      const chunks = svc.chunk(text, 1);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toContain('short course note');
      expect(chunks[0].chunkIndex).toBe(0);
      expect(chunks[0].pageNumber).toBe(1);
    });

    it('returns empty array for empty input', () => {
      const svc = makeService();
      expect(svc.chunk('', 1)).toEqual([]);
      expect(svc.chunk('   \n\n   ', 1)).toEqual([]);
    });

    it('splits multiple paragraphs separated by blank lines', () => {
      const svc = makeService();
      const paragraph = 'Sentence one explains topic A. Sentence two adds detail to topic A.';
      const text = `${paragraph}\n\n${paragraph.replace(/A/g, 'B')}\n\n${paragraph.replace(/A/g, 'C')}`;
      const chunks = svc.chunk(text, 3);
      expect(chunks.length).toBeGreaterThanOrEqual(3);
      expect(chunks[0].content).toContain('topic A');
      expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    });

    it('splits a long paragraph at sentence boundaries when exceeding target tokens', () => {
      const svc = makeService({ CHUNK_TARGET_TOKENS: 20, CHUNK_OVERLAP_TOKENS: 0 });
      const sentence = 'This is a moderately long sentence that contains roughly fifteen words plus padding.';
      const text = [sentence, sentence, sentence, sentence, sentence].join(' ');
      const chunks = svc.chunk(text, 1);
      expect(chunks.length).toBeGreaterThan(1);
      // No chunk should massively exceed ~target tokens (allowing 1 sentence overflow).
      for (const chunk of chunks) {
        expect(svc.estimateTokens(chunk.content)).toBeLessThan(40);
      }
    });

    it('hard-splits a sentence that exceeds target tokens on its own', () => {
      const svc = makeService({ CHUNK_TARGET_TOKENS: 30, CHUNK_OVERLAP_TOKENS: 0 });
      // 80 reasonably-long words joined by spaces — no sentence terminators, forces hard split.
      const giant = Array.from({ length: 80 }, (_, i) => `longwordnumber${i.toString().padStart(3, '0')}`).join(' ');
      const chunks = svc.chunk(giant, 1);
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        // Hard-split chunks should be near target tokens (allow some slack for last partial word).
        expect(svc.estimateTokens(chunk.content)).toBeLessThanOrEqual(45);
      }
    });

    it('filters chunks shorter than the minChunkChars threshold', () => {
      const svc = makeService();
      const text = 'short.\n\nThis next paragraph has more than fifty characters of actual content so it should survive.';
      const chunks = svc.chunk(text, 1);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toContain('survive');
    });

    it('produces overlapping content between adjacent chunks', () => {
      const svc = makeService({ CHUNK_TARGET_TOKENS: 20, CHUNK_OVERLAP_TOKENS: 10 });
      const para1 = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron.';
      const para2 = 'second paragraph begins here with distinct vocabulary that should not overlap by accident.';
      const chunks = svc.chunk(`${para1}\n\n${para2}`, 1);
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      // The second chunk should be prefixed with tail words from the first paragraph,
      // so it must contain at least one word from the END of para1.
      const para1LastWord = 'omicron';
      expect(chunks[1].content).toContain(para1LastWord);
      // ...and still contain its own paragraph's text.
      expect(chunks[1].content).toContain('second paragraph');
    });

    it('assigns sequential chunkIndex values starting at 0', () => {
      const svc = makeService();
      const text = Array(8)
        .fill('Sentence with enough characters to clear the minimum threshold easily.')
        .join('\n\n');
      const chunks = svc.chunk(text, 4);
      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i].chunkIndex).toBe(i);
      }
    });

    it('assigns pageNumber values within [1, pageCount]', () => {
      const svc = makeService();
      const text = Array(10)
        .fill('Paragraph containing enough text to clear the minimum chunk-length filter.')
        .join('\n\n');
      const chunks = svc.chunk(text, 5);
      for (const chunk of chunks) {
        expect(chunk.pageNumber).toBeGreaterThanOrEqual(1);
        expect(chunk.pageNumber).toBeLessThanOrEqual(5);
      }
    });

    it('falls back to page 1 when page count is zero', () => {
      const svc = makeService();
      const text = 'Some content that should still be chunked even if the page count is missing.';
      const chunks = svc.chunk(text, 0);
      expect(chunks[0].pageNumber).toBe(1);
    });

    it('honors override options passed to chunk()', () => {
      const svc = makeService();
      const text = Array(30).fill('word').join(' ');
      const tight = svc.chunk(text, 1, { targetTokens: 5, overlapTokens: 0, minChunkChars: 1 });
      const loose = svc.chunk(text, 1, { targetTokens: 1000, overlapTokens: 0, minChunkChars: 1 });
      expect(tight.length).toBeGreaterThan(loose.length);
    });
  });
});
