import { BadRequestException, Logger } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import type { PrismaService } from '../../database/prisma.service';
import { AcademicVerificationStatus } from '../../generated/prisma/enums';
import { VerificationService } from './verification.service';

jest.mock('pdf-parse', () => ({
  PDFParse: jest.fn().mockImplementation(({ data }: { data: Uint8Array }) => ({
    getInfo: jest.fn().mockResolvedValue({ total: 1 }),
    getText: jest.fn().mockResolvedValue({ text: Buffer.from(data).toString('latin1') }),
    destroy: jest.fn().mockResolvedValue(undefined),
  })),
}));

const userId = 'c90f70f4-5c66-4a14-88e4-d538a84dc26e';
const reportGuid = '5415d61a-7fbe-45a5-aa28-f75d87588991';

describe('VerificationService', () => {
  const transaction = {
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    academicVerification: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn(),
    },
  };
  const prisma = {
    user: { findUniqueOrThrow: jest.fn() },
    academicVerification: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    ),
  };
  const service = new VerificationService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction),
    );
  });

  it('aceita PDF consistente e encaminha a autenticidade para revisão administrativa', async () => {
    const submittedAt = new Date();
    const fileBuffer = makePdf([
      'DECLARACAO DE ESCOLARIDADE / VINCULO',
      `Joao da Silva UC12345678 ENGENHARIA DE SOFTWARE ${reportGuid}`,
    ]);
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      fullName: 'João da Silva',
      studentNumber: 'UC12345678',
      course: 'Engenharia de Software',
      academicVerification: null,
    });
    prisma.academicVerification.upsert.mockResolvedValue({
      userId,
      reportGuid,
      status: AcademicVerificationStatus.PENDING_REVIEW,
      submittedAt,
      reviewedAt: null,
      reviewNote: null,
    });

    const result = await service.submitAcademicDocument(userId, {
      originalname: 'declaracao.pdf',
      mimetype: 'application/pdf',
      buffer: fileBuffer,
    } as Express.Multer.File);

    expect(result.status).toBe(AcademicVerificationStatus.PENDING_REVIEW);
    expect(result.message).toContain('autenticidade será conferida');
    expect(prisma.academicVerification.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId, reportGuid }),
      }),
    );
    expect(fileBuffer.every((byte) => byte === 0)).toBe(true);
  });

  it('não cria solicitação se os dados do PDF não coincidirem', async () => {
    const fileBuffer = makePdf([
      'DECLARACAO DE ESCOLARIDADE / VINCULO',
      `Joao da Silva UC99999999 ENGENHARIA DE SOFTWARE ${reportGuid}`,
    ]);
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      fullName: 'João da Silva',
      studentNumber: 'UC12345678',
      course: 'Engenharia de Software',
      academicVerification: null,
    });

    await expect(
      service.submitAcademicDocument(userId, {
        originalname: 'declaracao.pdf',
        mimetype: 'application/pdf',
        buffer: fileBuffer,
      } as Express.Multer.File),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.academicVerification.upsert).not.toHaveBeenCalled();
    expect(fileBuffer.every((byte) => byte === 0)).toBe(true);
  });

  it('registra etapa e código técnico sem incluir mensagem com dados no log', async () => {
    const fileBuffer = makePdf([
      'DECLARACAO DE ESCOLARIDADE / VINCULO',
      `Joao da Silva UC12345678 ENGENHARIA DE SOFTWARE ${reportGuid}`,
    ]);
    const databaseError = Object.assign(new Error('sensitive value must not be logged'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      meta: { target: ['report_guid'] },
    });
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      fullName: 'João da Silva',
      studentNumber: 'UC12345678',
      course: 'Engenharia de Software',
      academicVerification: null,
    });
    prisma.academicVerification.upsert.mockRejectedValue(databaseError);

    try {
      await expect(
        service.submitAcademicDocument(
          userId,
          {
            originalname: 'declaracao.pdf',
            mimetype: 'application/pdf',
            buffer: fileBuffer,
          } as Express.Multer.File,
          'request-id',
        ),
      ).rejects.toBe(databaseError);

      const logEntry = JSON.parse(logger.mock.calls[0][0] as string) as Record<string, unknown>;
      expect(logEntry).toMatchObject({
        requestId: 'request-id',
        stage: 'persist-verification',
        errorType: 'PrismaClientKnownRequestError',
        errorCode: 'P2002',
        constraintFields: ['report_guid'],
      });
      expect(logger.mock.calls[0][0]).not.toContain('sensitive value');
      expect(fileBuffer.every((byte) => byte === 0)).toBe(true);
    } finally {
      logger.mockRestore();
    }
  });

  it('não falha se o parser desanexar seu próprio buffer ao finalizar', async () => {
    const fileBuffer = makePdf([
      'DECLARACAO DE ESCOLARIDADE / VINCULO',
      `Joao da Silva UC12345678 ENGENHARIA DE SOFTWARE ${reportGuid}`,
    ]);
    const detachedParser = jest.mocked(PDFParse);
    detachedParser.mockImplementationOnce((options) => {
      if (!(options.data instanceof Uint8Array))
        throw new Error('Teste requer bytes PDF em Uint8Array.');
      const { data } = options;
      return Object.assign(Object.create(PDFParse.prototype) as PDFParse, {
        getInfo: jest.fn().mockResolvedValue({ total: 1 }),
        getText: jest.fn().mockImplementation(() => {
          structuredClone(data.buffer, { transfer: [data.buffer] });
          return Promise.resolve({
            text: `DECLARACAO DE ESCOLARIDADE / VINCULO Joao da Silva UC12345678 ENGENHARIA DE SOFTWARE ${reportGuid}`,
          });
        }),
        destroy: jest.fn().mockResolvedValue(undefined),
      });
    });
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      fullName: 'João da Silva',
      studentNumber: 'UC12345678',
      course: 'Engenharia de Software',
      academicVerification: null,
    });
    prisma.academicVerification.upsert.mockResolvedValue({
      userId,
      reportGuid,
      status: AcademicVerificationStatus.PENDING_REVIEW,
      submittedAt: new Date(),
      reviewedAt: null,
      reviewNote: null,
    });

    await expect(
      service.submitAcademicDocument(userId, {
        originalname: 'declaracao.pdf',
        mimetype: 'application/pdf',
        buffer: fileBuffer,
      } as Express.Multer.File),
    ).resolves.toMatchObject({ status: AcademicVerificationStatus.PENDING_REVIEW });
    expect(fileBuffer.every((byte) => byte === 0)).toBe(true);
  });
});

function makePdf(lines: string[]) {
  const content = `BT /F1 12 Tf 10 700 Td ${lines
    .map((line, index) => `${index ? '0 -20 Td ' : ''}(${line}) Tj`)
    .join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
}
