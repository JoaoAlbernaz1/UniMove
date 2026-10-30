import { BadRequestException, HttpException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
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
const secret = 'email-verification-test-secret-that-is-long-enough';
const reportGuid = '5415d61a-7fbe-45a5-aa28-f75d87588991';

describe('VerificationService', () => {
  const configValues: Record<string, string> = {
    'email.resendApiKey': 'resend-test-key',
    'email.from': 'UniMove <no-reply@example.com>',
    'auth.emailVerificationSecret': secret,
  };
  const config = {
    get: jest.fn((key: string) => configValues[key]),
  };
  const transaction = {
    emailVerificationChallenge: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: { update: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    academicVerification: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn(),
    },
  };
  const prisma = {
    user: { findUniqueOrThrow: jest.fn() },
    emailVerificationChallenge: {
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    academicVerification: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    ),
  };
  const service = new VerificationService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
  );
  let fetchMock: jest.SpyInstance;

  beforeAll(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    prisma.emailVerificationChallenge.create.mockResolvedValue({});
    prisma.emailVerificationChallenge.updateMany.mockResolvedValue({ count: 1 });
    transaction.emailVerificationChallenge.deleteMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction),
    );
  });

  afterAll(() => fetchMock.mockRestore());

  it('envia código de 6 dígitos sem repetição e grava somente o HMAC', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      institutionalEmail: 'student@ucb.edu.br',
      institutionalEmailVerifiedAt: null,
    });
    prisma.emailVerificationChallenge.findUnique.mockResolvedValue(null);

    const result = await service.sendEmailCode(userId);
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const requestBody = typeof request.body === 'string' ? request.body : '';
    const body = JSON.parse(requestBody) as { text: string; to: string[] };
    const code = body.text.match(/\b\d{6}\b/)?.[0];

    expect(result.sent).toBe(true);
    expect(body.to).toEqual(['student@ucb.edu.br']);
    expect(code).toBeDefined();
    expect(new Set(code).size).toBe(6);
    expect(prisma.emailVerificationChallenge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId,
          codeHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          attempts: 0,
          expiresAt: expect.any(Date),
          resendAvailableAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.emailVerificationChallenge.create.mock.calls[0][0].data.codeHash).not.toBe(code);
  });

  it('impede pedir outro código antes de 60 segundos', async () => {
    const resendAvailableAt = new Date(Date.now() + 30_000);
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      institutionalEmail: 'student@ucb.edu.br',
      institutionalEmailVerifiedAt: null,
    });
    prisma.emailVerificationChallenge.findUnique.mockResolvedValue({ resendAvailableAt });

    await expect(service.sendEmailCode(userId)).rejects.toBeInstanceOf(HttpException);
    expect(prisma.emailVerificationChallenge.create).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejeita código incorreto e incrementa tentativas sem confirmar o e-mail', async () => {
    prisma.emailVerificationChallenge.findUnique.mockResolvedValue({
      userId,
      codeHash: hashFor('111111'),
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
    });

    await expect(service.verifyEmailCode(userId, '222222')).rejects.toThrow(
      'O código de verificação está incorreto.',
    );
    expect(prisma.emailVerificationChallenge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { attempts: { increment: 1 } } }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('confirma o e-mail uma única vez para o código correto', async () => {
    prisma.emailVerificationChallenge.findUnique.mockResolvedValue({
      userId,
      codeHash: hashFor('123456'),
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
    });

    await expect(service.verifyEmailCode(userId, '123456')).resolves.toEqual({ verified: true });
    expect(transaction.emailVerificationChallenge.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId, attempts: { lt: 5 } }),
      }),
    );
    expect(transaction.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: userId },
        data: { institutionalEmailVerifiedAt: expect.any(Date) },
      }),
    );
  });

  it('aceita PDF consistente e encaminha a autenticidade para revisão administrativa', async () => {
    const submittedAt = new Date();
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      fullName: 'João da Silva',
      studentNumber: 'UC12345678',
      course: 'Engenharia de Software',
      institutionalEmailVerifiedAt: new Date(),
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
      buffer: makePdf([
        'DECLARACAO DE ESCOLARIDADE / VINCULO',
        `Joao da Silva UC12345678 ENGENHARIA DE SOFTWARE ${reportGuid}`,
      ]),
    } as Express.Multer.File);

    expect(result.status).toBe(AcademicVerificationStatus.PENDING_REVIEW);
    expect(result.message).toContain('autenticidade será conferida');
    expect(prisma.academicVerification.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId, reportGuid }),
      }),
    );
  });

  it('não cria solicitação se os dados do PDF não coincidirem', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      fullName: 'João da Silva',
      studentNumber: 'UC12345678',
      course: 'Engenharia de Software',
      institutionalEmailVerifiedAt: new Date(),
      academicVerification: null,
    });

    await expect(
      service.submitAcademicDocument(userId, {
        originalname: 'declaracao.pdf',
        mimetype: 'application/pdf',
        buffer: makePdf([
          'DECLARACAO DE ESCOLARIDADE / VINCULO',
          `Joao da Silva UC99999999 ENGENHARIA DE SOFTWARE ${reportGuid}`,
        ]),
      } as Express.Multer.File),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.academicVerification.upsert).not.toHaveBeenCalled();
  });
});

function hashFor(code: string) {
  return createHmac('sha256', secret).update(`${userId}:${code}`).digest('hex');
}

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
