import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ChunkRecord {
  content: string;
  chunkIndex: number;
  pageNumber: number;
  startChar: number;
  endChar: number;
}

export interface ChunkingOptions {
  targetTokens: number;
  overlapTokens: number;
  minChunkChars: number;
}

const WORDS_TO_TOKENS = 1.3;
const DEFAULT_OPTIONS: ChunkingOptions = {
  targetTokens: 500,
  overlapTokens: 50,
  minChunkChars: 50,
};

@Injectable()
export class ChunkingService {
  private readonly options: ChunkingOptions;

  constructor(config: ConfigService) {
    this.options = {
      targetTokens: Number(config.get('CHUNK_TARGET_TOKENS', DEFAULT_OPTIONS.targetTokens)),
      overlapTokens: Number(config.get('CHUNK_OVERLAP_TOKENS', DEFAULT_OPTIONS.overlapTokens)),
      minChunkChars: DEFAULT_OPTIONS.minChunkChars,
    };
  }

  estimateTokens(text: string): number {
    if (!text) return 0;
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    return Math.ceil(wordCount * WORDS_TO_TOKENS);
  }

  chunk(text: string, pageCount: number, overrides?: Partial<ChunkingOptions>): ChunkRecord[] {
    const opts: ChunkingOptions = { ...this.options, ...overrides };
    const cleaned = this.normalize(text);
    if (!cleaned) return [];

    const totalChars = cleaned.length;
    const paragraphs = this.splitParagraphs(cleaned);
    const rawSegments: Array<{ text: string; startChar: number }> = [];

    for (const para of paragraphs) {
      const paraTokens = this.estimateTokens(para.text);
      if (paraTokens <= opts.targetTokens) {
        rawSegments.push(para);
        continue;
      }
      // Split paragraph at sentence boundaries
      const sentenceGroups = this.groupSentences(para.text, para.startChar, opts.targetTokens);
      for (const group of sentenceGroups) {
        if (this.estimateTokens(group.text) <= opts.targetTokens) {
          rawSegments.push(group);
        } else {
          // Hard split
          const hard = this.hardSplit(group.text, group.startChar, opts.targetTokens);
          rawSegments.push(...hard);
        }
      }
    }

    // Apply overlap by prefixing the tail of the previous chunk to the next
    const overlapped: ChunkRecord[] = [];
    let chunkIndex = 0;
    for (let i = 0; i < rawSegments.length; i++) {
      const seg = rawSegments[i];
      let content = seg.text.trim();
      let startChar = seg.startChar;
      if (i > 0 && opts.overlapTokens > 0) {
        const prev = rawSegments[i - 1];
        const overlap = this.takeOverlapTail(prev.text, opts.overlapTokens);
        if (overlap) {
          content = `${overlap.trim()} ${content}`.trim();
          startChar = Math.max(0, prev.startChar + prev.text.length - overlap.length);
        }
      }
      if (content.length < opts.minChunkChars) continue;
      overlapped.push({
        content,
        chunkIndex: chunkIndex++,
        pageNumber: this.estimatePageNumber(startChar, totalChars, pageCount),
        startChar,
        endChar: seg.startChar + seg.text.length,
      });
    }
    return overlapped;
  }

  private normalize(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/ /g, ' ').trim();
  }

  private splitParagraphs(text: string): Array<{ text: string; startChar: number }> {
    const result: Array<{ text: string; startChar: number }> = [];
    const regex = /\n\s*\n/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const segment = text.slice(lastIndex, match.index);
      if (segment.trim().length > 0) {
        result.push({ text: segment, startChar: lastIndex });
      }
      lastIndex = match.index + match[0].length;
    }
    const tail = text.slice(lastIndex);
    if (tail.trim().length > 0) {
      result.push({ text: tail, startChar: lastIndex });
    }
    return result;
  }

  private groupSentences(
    text: string,
    baseStart: number,
    targetTokens: number,
  ): Array<{ text: string; startChar: number }> {
    const sentences = this.splitSentences(text, baseStart);
    const groups: Array<{ text: string; startChar: number }> = [];
    let current: { text: string; startChar: number } | null = null;
    for (const sentence of sentences) {
      if (current === null) {
        current = { text: sentence.text, startChar: sentence.startChar };
        continue;
      }
      const combined = `${current.text} ${sentence.text}`;
      if (this.estimateTokens(combined) <= targetTokens) {
        current.text = combined;
      } else {
        groups.push(current);
        current = { text: sentence.text, startChar: sentence.startChar };
      }
    }
    if (current) groups.push(current);
    return groups;
  }

  private splitSentences(
    text: string,
    baseStart: number,
  ): Array<{ text: string; startChar: number }> {
    const result: Array<{ text: string; startChar: number }> = [];
    const regex = /[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const value = match[0];
      if (value.trim().length === 0) continue;
      result.push({ text: value.trim(), startChar: baseStart + match.index });
    }
    if (result.length === 0 && text.trim().length > 0) {
      result.push({ text: text.trim(), startChar: baseStart });
    }
    return result;
  }

  private hardSplit(
    text: string,
    baseStart: number,
    targetTokens: number,
  ): Array<{ text: string; startChar: number }> {
    const words = text.split(/(\s+)/);
    const targetWords = Math.max(1, Math.floor(targetTokens / WORDS_TO_TOKENS));
    const chunks: Array<{ text: string; startChar: number }> = [];
    let buffer = '';
    let bufferWordCount = 0;
    let bufferStart = baseStart;
    let pointer = baseStart;
    for (const token of words) {
      buffer += token;
      pointer += token.length;
      if (/\S/.test(token)) bufferWordCount++;
      if (bufferWordCount >= targetWords) {
        chunks.push({ text: buffer, startChar: bufferStart });
        bufferStart = pointer;
        buffer = '';
        bufferWordCount = 0;
      }
    }
    if (buffer.trim().length > 0) {
      chunks.push({ text: buffer, startChar: bufferStart });
    }
    return chunks;
  }

  private takeOverlapTail(text: string, overlapTokens: number): string {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const tailWordCount = Math.min(
      words.length,
      Math.max(1, Math.floor(overlapTokens / WORDS_TO_TOKENS)),
    );
    return words.slice(words.length - tailWordCount).join(' ');
  }

  private estimatePageNumber(charPosition: number, totalChars: number, pageCount: number): number {
    if (pageCount <= 0 || totalChars <= 0) return 1;
    const estimate = Math.floor((charPosition / totalChars) * pageCount) + 1;
    return Math.max(1, Math.min(pageCount, estimate));
  }
}
