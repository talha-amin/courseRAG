import { Injectable, UnprocessableEntityException } from '@nestjs/common';
// pdf-parse has no proper ESM/TS types and exports CJS. Importing the main
// entry runs an initializer that opens a test file during dev; using the
// internal module bypasses that.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse: (data: Buffer) => Promise<{ text: string; numpages: number }> = require('pdf-parse/lib/pdf-parse.js');

export interface ParsedPdf {
  text: string;
  pageCount: number;
}

@Injectable()
export class PdfParserService {
  async parse(buffer: Buffer): Promise<ParsedPdf> {
    let parsed: { text: string; numpages: number };
    try {
      parsed = await pdfParse(buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown PDF parsing error';
      throw new UnprocessableEntityException(`Failed to parse PDF: ${message}`);
    }
    const text = (parsed.text ?? '').trim();
    if (text.length === 0) {
      throw new UnprocessableEntityException(
        'PDF contains no extractable text. It may be image-only or empty.',
      );
    }
    return { text, pageCount: Math.max(1, parsed.numpages || 1) };
  }
}
