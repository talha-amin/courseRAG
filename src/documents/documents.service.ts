import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Document } from './entities/document.entity';
import { Chunk } from './entities/chunk.entity';
import { ChunkingService } from './chunking.service';
import { PdfParserService } from './pdf-parser.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import {
  DocumentSummaryDto,
  UploadDocumentResponseDto,
} from './dto/document-response.dto';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @InjectRepository(Document) private readonly documents: Repository<Document>,
    @InjectRepository(Chunk) private readonly chunks: Repository<Chunk>,
    private readonly chunking: ChunkingService,
    private readonly embeddings: EmbeddingsService,
    private readonly pdfParser: PdfParserService,
    private readonly dataSource: DataSource,
  ) {}

  async ingestPdf(file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
  }): Promise<UploadDocumentResponseDto> {
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Only PDF files are accepted (Content-Type application/pdf).');
    }
    const start = Date.now();

    const { text, pageCount } = await this.pdfParser.parse(file.buffer);
    const chunkRecords = this.chunking.chunk(text, pageCount);
    if (chunkRecords.length === 0) {
      throw new BadRequestException('PDF text could not be chunked (no usable content found).');
    }

    const filename = this.buildStoredFilename(file.originalname);
    const document = this.documents.create({
      filename,
      originalName: file.originalname,
      pageCount,
      chunkCount: chunkRecords.length,
    });
    const savedDocument = await this.documents.save(document);

    const vectors = await this.embeddings.embedBatch(chunkRecords.map((c) => c.content));
    const chunkEntities = chunkRecords.map((record, index) =>
      this.chunks.create({
        documentId: savedDocument.id,
        content: record.content,
        chunkIndex: record.chunkIndex,
        pageNumber: record.pageNumber,
        embedding: this.embeddings.formatForPgVector(vectors[index]),
      }),
    );
    await this.chunks.save(chunkEntities, { chunk: 100 });

    const processingTimeMs = Date.now() - start;
    this.logger.log(
      `Ingested ${file.originalname}: ${pageCount} pages, ${chunkRecords.length} chunks in ${processingTimeMs}ms`,
    );

    return {
      documentId: savedDocument.id,
      filename: savedDocument.filename,
      pageCount,
      chunkCount: chunkRecords.length,
      processingTimeMs,
    };
  }

  async list(): Promise<DocumentSummaryDto[]> {
    const documents = await this.documents.find({ order: { createdAt: 'DESC' } });
    return documents.map((d) => this.toSummary(d));
  }

  async findOne(id: string): Promise<DocumentSummaryDto> {
    const document = await this.documents.findOne({ where: { id } });
    if (!document) {
      throw new NotFoundException(`Document ${id} not found`);
    }
    return this.toSummary(document);
  }

  async remove(id: string): Promise<void> {
    const document = await this.documents.findOne({ where: { id } });
    if (!document) {
      throw new NotFoundException(`Document ${id} not found`);
    }
    await this.documents.delete({ id });
  }

  async assertExists(id: string): Promise<void> {
    const count = await this.documents.count({ where: { id } });
    if (count === 0) throw new NotFoundException(`Document ${id} not found`);
  }

  private toSummary(d: Document): DocumentSummaryDto {
    return {
      id: d.id,
      filename: d.filename,
      originalName: d.originalName,
      pageCount: d.pageCount,
      chunkCount: d.chunkCount,
      createdAt: d.createdAt.toISOString(),
    };
  }

  private buildStoredFilename(originalName: string): string {
    const safe = originalName.replace(/[^a-z0-9._-]/gi, '_').slice(-200);
    return `${Date.now()}_${safe}`;
  }
}
