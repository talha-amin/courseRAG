import Anthropic from '@anthropic-ai/sdk';
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RetrievedChunk } from './retrieval.service';

export interface GroundingEvaluation {
  isGrounded: boolean;
  confidence: number;
  unsupportedClaims: string[];
  reasoning: string;
}

const ANSWER_SYSTEM_PROMPT = `You are a precise academic tutor. Answer the student's question using ONLY the provided context passages from their course material.

Rules:
- If the answer is found in the context: answer clearly and cite the source passage(s) using [Chunk N, Page P] notation.
- If the answer is NOT in the provided context: respond exactly with: "I cannot answer this question based on the provided course material. The relevant information may be on a different section not yet uploaded."
- Never use outside knowledge. Never hallucinate.
- Be concise and academically precise.`;

const HALLUCINATION_SYSTEM_PROMPT = `You are a fact-checking assistant. Evaluate whether an answer is fully grounded in the provided source passages.

Return ONLY valid JSON matching this exact schema (no surrounding prose, no markdown fences):
{
  "isGrounded": boolean,
  "confidence": number,
  "unsupportedClaims": string[],
  "reasoning": string
}

Where:
- isGrounded is true iff every factual claim is directly supported by the passages
- confidence is a number between 0.0 and 1.0
- unsupportedClaims lists individual claims not supported by the passages (empty array if all supported)
- reasoning is a one-sentence explanation`;

@Injectable()
export class ClaudeService {
  private readonly logger = new Logger(ClaudeService.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(config: ConfigService) {
    const apiKey = config.getOrThrow<string>('process.env.ANTHROPIC_API_KEY');
    this.client = new Anthropic({ apiKey });
    this.model = config.get<string>('ANTHROPIC_MODEL', 'claude-sonnet-4-6');
  }

  async generateGroundedAnswer(question: string, chunks: RetrievedChunk[]): Promise<string> {
    const context = this.formatContext(chunks);
    try {
      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: ANSWER_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Context passages:\n${context}\n\nStudent question: ${question}`,
          },
        ],
      });
      return this.extractText(message);
    } catch (err) {
      throw this.wrapError(err, 'Claude grounded-answer call failed');
    }
  }

  async evaluateGrounding(
    answer: string,
    chunks: RetrievedChunk[],
  ): Promise<GroundingEvaluation> {
    const context = this.formatContext(chunks);
    try {
      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: 512,
        system: HALLUCINATION_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Source passages:\n${context}\n\nAnswer to evaluate:\n${answer}`,
          },
        ],
      });
      const raw = this.extractText(message);
      return this.parseEvaluation(raw);
    } catch (err) {
      throw this.wrapError(err, 'Claude grounding-evaluation call failed');
    }
  }

  private formatContext(chunks: RetrievedChunk[]): string {
    return chunks
      .map(
        (chunk) => `[Chunk ${chunk.chunkIndex}] (Page ${chunk.pageNumber}): ${chunk.content}`,
      )
      .join('\n\n');
  }

  private extractText(message: Anthropic.Message): string {
    const textBlocks = message.content.filter(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );
    return textBlocks.map((b) => b.text).join('').trim();
  }

  private parseEvaluation(raw: string): GroundingEvaluation {
    const cleaned = this.stripCodeFences(raw);
    const jsonText = this.extractJsonObject(cleaned);
    try {
      const parsed = JSON.parse(jsonText) as Partial<GroundingEvaluation>;
      const isGrounded = Boolean(parsed.isGrounded);
      const confidence = this.clamp(Number(parsed.confidence), 0, 1);
      const unsupportedClaims = Array.isArray(parsed.unsupportedClaims)
        ? parsed.unsupportedClaims.filter((c): c is string => typeof c === 'string')
        : [];
      const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';
      return { isGrounded, confidence, unsupportedClaims, reasoning };
    } catch (err) {
      this.logger.warn(`Failed to parse grounding evaluation JSON: ${this.errorMessage(err)}`);
      return {
        isGrounded: false,
        confidence: 0,
        unsupportedClaims: ['Hallucination check returned malformed JSON'],
        reasoning: 'Grounding evaluator response could not be parsed.',
      };
    }
  }

  private stripCodeFences(raw: string): string {
    return raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }

  private extractJsonObject(text: string): string {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
      return text;
    }
    return text.slice(firstBrace, lastBrace + 1);
  }

  private clamp(value: number, min: number, max: number): number {
    if (Number.isNaN(value)) return min;
    return Math.max(min, Math.min(max, value));
  }

  private wrapError(err: unknown, context: string): HttpException {
    const message = this.errorMessage(err);
    this.logger.error(`${context}: ${message}`);
    return new HttpException(
      `${context}. The upstream LLM provider may be unavailable — please retry.`,
      HttpStatus.BAD_GATEWAY,
    );
  }

  private errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
