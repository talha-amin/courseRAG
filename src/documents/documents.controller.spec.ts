import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

function makeConfig(maxMb = 10): ConfigService {
  return {
    get: <T>(_key: string, fallback: T): T => String(maxMb) as unknown as T,
  } as unknown as ConfigService;
}

function makeFile(overrides: Partial<{
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}> = {}): {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
} {
  const buffer = overrides.buffer ?? Buffer.from('%PDF-1.4 fake');
  return {
    fieldname: 'file',
    originalname: overrides.originalname ?? 'lecture.pdf',
    encoding: '7bit',
    mimetype: overrides.mimetype ?? 'application/pdf',
    buffer,
    size: overrides.size ?? buffer.length,
  };
}

describe('DocumentsController', () => {
  let controller: DocumentsController;
  let service: jest.Mocked<DocumentsService>;

  beforeEach(() => {
    service = {
      ingestPdf: jest.fn(),
      list: jest.fn(),
      findOne: jest.fn(),
      remove: jest.fn(),
      assertExists: jest.fn(),
    } as unknown as jest.Mocked<DocumentsService>;
    controller = new DocumentsController(service, makeConfig(10));
  });

  describe('POST /documents/upload', () => {
    it('accepts a valid PDF and returns the ingestion summary (201)', async () => {
      const expected = {
        documentId: '7f8d12a4-aaaa-bbbb-cccc-1234567890ab',
        filename: '12345_lecture.pdf',
        pageCount: 12,
        chunkCount: 47,
        processingTimeMs: 3420,
      };
      service.ingestPdf.mockResolvedValue(expected);

      const result = await controller.upload(makeFile());

      expect(result).toEqual(expected);
      expect(service.ingestPdf).toHaveBeenCalledWith(expect.objectContaining({
        originalname: 'lecture.pdf',
        mimetype: 'application/pdf',
      }));
    });

    it('rejects requests without a file with 400', async () => {
      await expect(controller.upload(undefined)).rejects.toBeInstanceOf(BadRequestException);
      expect(service.ingestPdf).not.toHaveBeenCalled();
    });

    it('rejects non-PDF mimetypes with 400', async () => {
      await expect(
        controller.upload(makeFile({ mimetype: 'image/png', originalname: 'foo.png' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(service.ingestPdf).not.toHaveBeenCalled();
    });

    it('rejects files larger than the configured limit with 413', async () => {
      controller = new DocumentsController(service, makeConfig(1));
      const big = makeFile({ size: 2 * 1024 * 1024 });
      await expect(controller.upload(big)).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(service.ingestPdf).not.toHaveBeenCalled();
    });
  });

  describe('GET /documents', () => {
    it('returns an array of document summaries', async () => {
      service.list.mockResolvedValue([
        {
          id: 'a',
          filename: 'a.pdf',
          originalName: 'A.pdf',
          pageCount: 1,
          chunkCount: 2,
          createdAt: '2026-06-20T00:00:00.000Z',
        },
      ]);
      const result = await controller.list();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('a');
    });

    it('returns an empty array when no documents exist', async () => {
      service.list.mockResolvedValue([]);
      expect(await controller.list()).toEqual([]);
    });
  });

  describe('GET /documents/:id', () => {
    it('returns a single document summary', async () => {
      const summary = {
        id: 'a',
        filename: 'a.pdf',
        originalName: 'A.pdf',
        pageCount: 5,
        chunkCount: 10,
        createdAt: '2026-06-20T00:00:00.000Z',
      };
      service.findOne.mockResolvedValue(summary);
      expect(await controller.findOne('a')).toBe(summary);
    });

    it('propagates 404 when the document does not exist', async () => {
      service.findOne.mockRejectedValue(new NotFoundException('Document missing not found'));
      await expect(controller.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('DELETE /documents/:id', () => {
    it('returns 204 (void) and calls the service', async () => {
      service.remove.mockResolvedValue(undefined);
      const result = await controller.remove('5d8c0a3a-7c8c-4c19-b1b1-1234567890ab');
      expect(result).toBeUndefined();
      expect(service.remove).toHaveBeenCalledWith('5d8c0a3a-7c8c-4c19-b1b1-1234567890ab');
    });

    it('propagates 404 from the service', async () => {
      service.remove.mockRejectedValue(new NotFoundException('Document missing not found'));
      await expect(controller.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
