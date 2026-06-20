import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiParam,
} from '@nestjs/swagger';
import {
  DocumentSummaryDto,
  UploadDocumentResponseDto,
} from './dto/document-response.dto';
import { DocumentsService } from './documents.service';

interface UploadedMulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

@ApiTags('documents')
@Controller('documents')
export class DocumentsController {
  private readonly maxFileSizeBytes: number;

  constructor(
    private readonly documentsService: DocumentsService,
    config: ConfigService,
  ) {
    const maxMb = Number(config.get<string>('MAX_FILE_SIZE_MB', '10'));
    this.maxFileSizeBytes = maxMb * 1024 * 1024;
  }

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Upload a PDF course document',
    description:
      'Parses the PDF, chunks it into ~500-token segments with 50-token overlap, embeds each chunk with OpenAI text-embedding-3-small, and stores everything in Postgres+pgvector.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'PDF file (max 10MB)',
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, type: UploadDocumentResponseDto })
  @ApiResponse({ status: 400, description: 'File is missing or not a PDF' })
  @ApiResponse({ status: 413, description: 'File exceeds 10MB limit' })
  @ApiResponse({ status: 422, description: 'PDF contains no extractable text' })
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: UploadedMulterFile | undefined,
  ): Promise<UploadDocumentResponseDto> {
    if (!file) {
      throw new BadRequestException('A file must be uploaded under the "file" field.');
    }
    if (file.size > this.maxFileSizeBytes) {
      throw new PayloadTooLargeException(
        `File exceeds maximum size of ${this.maxFileSizeBytes / 1024 / 1024}MB`,
      );
    }
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Only PDF files are accepted (Content-Type application/pdf).');
    }
    return this.documentsService.ingestPdf(file);
  }

  @Get()
  @ApiOperation({ summary: 'List all uploaded documents' })
  @ApiResponse({ status: 200, type: [DocumentSummaryDto] })
  async list(): Promise<DocumentSummaryDto[]> {
    return this.documentsService.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single document by ID' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: DocumentSummaryDto })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<DocumentSummaryDto> {
    return this.documentsService.findOne(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a document and all its chunks' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.documentsService.remove(id);
  }
}
