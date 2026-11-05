import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AcademicVerificationStatus, RoleName } from '../../generated/prisma/enums';
import { PrismaService } from '../../database/prisma.service';
import { PDFParse } from 'pdf-parse';

const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_PDF_PAGES = 5;
const REPORT_GUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const verificationLogger = new Logger('VerificationService');
const verificationSelect = {
  userId: true,
  reportGuid: true,
  status: true,
  submittedAt: true,
  reviewedAt: true,
  reviewNote: true,
} as const;

@Injectable()
export class VerificationService {
  constructor(private readonly prisma: PrismaService) {}

  async status(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        academicVerification: { select: verificationSelect },
      },
    });
    return {
      academic: user.academicVerification
        ? {
            status: user.academicVerification.status,
            submittedAt: user.academicVerification.submittedAt,
            reviewedAt: user.academicVerification.reviewedAt,
            reviewNote: user.academicVerification.reviewNote,
          }
        : null,
    };
  }

  async submitAcademicDocument(userId: string, file?: Express.Multer.File, requestId?: string) {
    if (!file) throw new BadRequestException('Selecione o comprovante de matrícula em PDF.');
    let stage = 'validate-upload';
    try {
      if (
        !['application/pdf', 'application/octet-stream'].includes(file.mimetype) ||
        !file.originalname.toLowerCase().endsWith('.pdf') ||
        !file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))
      )
        throw new BadRequestException('O arquivo enviado não é um PDF válido.');
      if (!file.buffer.length || file.buffer.length > MAX_PDF_BYTES)
        throw new BadRequestException('O PDF deve ter até 5 MB.');

      stage = 'load-user-profile';
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          fullName: true,
          studentNumber: true,
          course: true,
          academicVerification: { select: { status: true } },
        },
      });
      if (!user.studentNumber || !user.course)
        throw new ConflictException('Cadastre sua matrícula e seu curso antes de enviar o PDF.');
      if (
        user.academicVerification?.status === AcademicVerificationStatus.PENDING_REVIEW ||
        user.academicVerification?.status === AcademicVerificationStatus.APPROVED
      )
        throw new ConflictException('Já existe uma validação pendente ou aprovada.');

      stage = 'parse-and-validate-pdf';
      const reportGuid = await extractAndValidateReport(file.buffer, {
        fullName: user.fullName,
        studentNumber: user.studentNumber,
        course: user.course,
      });

      stage = 'persist-verification';
      const verification = await this.prisma.academicVerification.upsert({
        where: { userId },
        create: {
          userId,
          reportGuid,
          status: AcademicVerificationStatus.PENDING_REVIEW,
        },
        update: {
          reportGuid,
          status: AcademicVerificationStatus.PENDING_REVIEW,
          submittedAt: new Date(),
          reviewedAt: null,
          reviewedById: null,
          reviewNote: null,
        },
        select: verificationSelect,
      });
      stage = 'persist-audit-log';
      await this.prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'ACADEMIC_VERIFICATION_SUBMITTED',
          entityType: 'AcademicVerification',
          entityId: userId,
        },
      });
      return {
        status: verification.status,
        submittedAt: verification.submittedAt,
        message:
          'Os dados do PDF coincidem com seu cadastro. A autenticidade será conferida por um administrador no portal oficial.',
      };
    } catch (error) {
      if (!(error instanceof HttpException) || error.getStatus() >= 500) {
        verificationLogger.error(
          JSON.stringify({
            requestId,
            stage,
            ...safeErrorDetails(error),
          }),
        );
      }
      throw error;
    } finally {
      file.buffer.fill(0);
    }
  }

  async listReviews(status: AcademicVerificationStatus, skip: number, take: number) {
    const where = { status };
    const [items, total] = await Promise.all([
      this.prisma.academicVerification.findMany({
        where,
        include: {
          user: {
            select: {
              fullName: true,
              institutionalEmail: true,
              studentNumber: true,
              course: true,
            },
          },
          reviewedBy: { select: { fullName: true } },
        },
        // Pendentes: a mais antiga primeiro. Decididas: a mais recente primeiro.
        orderBy:
          status === AcademicVerificationStatus.PENDING_REVIEW
            ? { submittedAt: 'asc' }
            : { reviewedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.academicVerification.count({ where }),
    ]);
    return { items, total };
  }

  async review(
    actor: { id: string; roles: RoleName[] },
    userId: string,
    status: 'APPROVED' | 'REJECTED',
    reviewNote?: string,
  ) {
    if (status === AcademicVerificationStatus.REJECTED && !reviewNote?.trim())
      throw new BadRequestException('Informe o motivo da rejeição.');
    const result = await this.prisma.$transaction(async (tx) => {
      const update = await tx.academicVerification.updateMany({
        where: { userId, status: AcademicVerificationStatus.PENDING_REVIEW },
        data: {
          status,
          reviewedAt: new Date(),
          reviewedById: actor.id,
          reviewNote: reviewNote?.trim() || null,
        },
      });
      if (!update.count) {
        const existing = await tx.academicVerification.findUnique({
          where: { userId },
          select: { status: true },
        });
        if (!existing) throw new NotFoundException('Validação não encontrada.');
        throw new ConflictException({
          code: 'VERIFICATION_ALREADY_DECIDED',
          message: 'Esta validação já foi decidida por outro administrador.',
        });
      }
      const verification = await tx.academicVerification.findUniqueOrThrow({
        where: { userId },
        include: {
          user: {
            select: { fullName: true, institutionalEmail: true, studentNumber: true, course: true },
          },
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: `ACADEMIC_VERIFICATION_${status}`,
          entityType: 'AcademicVerification',
          entityId: userId,
          metadata: { reviewNote: reviewNote?.trim() || null },
        },
      });
      return verification;
    });
    return result;
  }
}

function safeErrorDetails(error: unknown) {
  if (!(error instanceof Error)) return { errorType: typeof error };
  const details = error as Error & {
    code?: unknown;
    meta?: { target?: unknown };
  };
  const errorCode =
    typeof details.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(details.code)
      ? details.code
      : undefined;
  return {
    errorType: error.name,
    ...(errorCode ? { errorCode } : {}),
    ...(Array.isArray(details.meta?.target) &&
    details.meta.target.every((target) => typeof target === 'string')
      ? { constraintFields: details.meta.target }
      : {}),
  };
}

async function extractAndValidateReport(
  buffer: Buffer,
  expected: { fullName: string; studentNumber: string; course: string },
) {
  let text: string;
  const pdfData = new Uint8Array(buffer);
  const parser = new PDFParse({ data: pdfData, stopAtErrors: true });
  try {
    const info = await parser.getInfo();
    if (info.total > MAX_PDF_PAGES)
      throw new BadRequestException(`O comprovante deve ter no máximo ${MAX_PDF_PAGES} páginas.`);
    text = (await parser.getText()).text;
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    verificationLogger.error(
      'Falha ao extrair texto do comprovante PDF.',
      error instanceof Error ? error.stack : undefined,
    );
    throw new BadRequestException(
      'Não foi possível ler o PDF. Envie o comprovante digital original, não uma imagem escaneada.',
    );
  } finally {
    await parser.destroy();
  }

  const normalizedText = normalizeDocumentText(text);
  if (!normalizedText)
    throw new BadRequestException('O PDF não contém texto legível para validação automática.');
  if (!normalizedText.includes('declaracao de escolaridade vinculo'))
    throw new BadRequestException(
      'O PDF não corresponde ao modelo de declaração de vínculo acadêmico esperado.',
    );
  if (!containsDocumentPhrase(normalizedText, expected.fullName))
    throw new BadRequestException('O nome no comprovante não corresponde ao nome do cadastro.');
  if (!containsDocumentPhrase(normalizedText, expected.studentNumber))
    throw new BadRequestException('A matrícula no comprovante não corresponde ao cadastro.');
  if (!containsDocumentPhrase(normalizedText, expected.course))
    throw new BadRequestException('O curso no comprovante não corresponde ao cadastro.');

  const reportGuid = text.match(REPORT_GUID_PATTERN)?.[0];
  if (!reportGuid)
    throw new BadRequestException(
      'Não foi encontrado no PDF o código de identificação do relatório oficial.',
    );
  return reportGuid.toLowerCase();
}

function normalizeDocumentText(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function containsDocumentPhrase(documentText: string, value: string) {
  const phrase = normalizeDocumentText(value);
  return ` ${documentText} `.includes(` ${phrase} `);
}
