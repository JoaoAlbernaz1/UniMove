import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import { AcademicVerificationStatus, RoleName } from '../../generated/prisma/enums';
import { PrismaService } from '../../database/prisma.service';
import { PDFParse } from 'pdf-parse';

const CODE_LENGTH = 6;
const CODE_LIFETIME_MS = 10 * 60 * 1000;
const RESEND_DELAY_MS = 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
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
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async status(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        institutionalEmailVerifiedAt: true,
        academicVerification: { select: verificationSelect },
        emailVerificationChallenge: { select: { resendAvailableAt: true } },
      },
    });
    return {
      emailVerified: user.institutionalEmailVerifiedAt !== null,
      resendAvailableAt: user.emailVerificationChallenge?.resendAvailableAt ?? null,
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

  async sendEmailCode(userId: string) {
    const { apiKey, from, hmacSecret } = this.emailConfiguration();
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { institutionalEmail: true, institutionalEmailVerifiedAt: true },
    });
    if (user.institutionalEmailVerifiedAt)
      throw new ConflictException('O e-mail institucional já foi verificado.');

    const now = new Date();
    const current = await this.prisma.emailVerificationChallenge.findUnique({
      where: { userId },
      select: { resendAvailableAt: true },
    });
    if (current && current.resendAvailableAt > now)
      throw this.resendCooldown(current.resendAvailableAt, now);

    const code = createUniqueDigitCode();
    const codeHash = hashCode(hmacSecret, userId, code);
    const expiresAt = new Date(now.getTime() + CODE_LIFETIME_MS);
    const resendAvailableAt = new Date(now.getTime() + RESEND_DELAY_MS);
    await this.reserveCode(userId, codeHash, expiresAt, resendAvailableAt, now);
    await this.sendResendEmail(apiKey, from, user.institutionalEmail, code);

    return { sent: true, expiresAt, resendAvailableAt };
  }

  async verifyEmailCode(userId: string, code: string) {
    const hmacSecret = this.config.get<string>('auth.emailVerificationSecret');
    if (!hmacSecret || hmacSecret.length < 32)
      throw new ServiceUnavailableException('A verificação de e-mail não está configurada.');

    const challenge = await this.prisma.emailVerificationChallenge.findUnique({
      where: { userId },
    });
    if (!challenge) throw new BadRequestException('Solicite um código antes de verificá-lo.');
    const now = new Date();
    if (challenge.expiresAt <= now)
      throw new BadRequestException('O código expirou. Solicite um novo código.');
    if (challenge.attempts >= MAX_CODE_ATTEMPTS)
      throw new HttpException(
        'Limite de tentativas atingido. Solicite outro código.',
        HttpStatus.TOO_MANY_REQUESTS,
      );

    const expectedHash = Buffer.from(challenge.codeHash, 'hex');
    const providedHash = Buffer.from(hashCode(hmacSecret, userId, code), 'hex');
    if (!timingSafeEqual(expectedHash, providedHash)) {
      const update = await this.prisma.emailVerificationChallenge.updateMany({
        where: {
          userId,
          codeHash: challenge.codeHash,
          expiresAt: { gt: now },
          attempts: { lt: MAX_CODE_ATTEMPTS },
        },
        data: { attempts: { increment: 1 } },
      });
      if (!update.count)
        throw new HttpException(
          'Limite de tentativas atingido ou código substituído. Solicite outro código.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      throw new BadRequestException('O código de verificação está incorreto.');
    }

    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.emailVerificationChallenge.deleteMany({
        where: {
          userId,
          codeHash: challenge.codeHash,
          expiresAt: { gt: now },
          attempts: { lt: MAX_CODE_ATTEMPTS },
        },
      });
      if (!consumed.count) throw new BadRequestException('O código expirou ou já foi utilizado.');
      await tx.user.update({
        where: { id: userId },
        data: { institutionalEmailVerifiedAt: now },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'INSTITUTIONAL_EMAIL_VERIFIED',
          entityType: 'User',
          entityId: userId,
        },
      });
    });
    return { verified: true };
  }

  async submitAcademicDocument(userId: string, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Selecione o comprovante de matrícula em PDF.');
    if (
      !['application/pdf', 'application/octet-stream'].includes(file.mimetype) ||
      !file.originalname.toLowerCase().endsWith('.pdf') ||
      !file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))
    )
      throw new BadRequestException('O arquivo enviado não é um PDF válido.');
    if (!file.buffer.length || file.buffer.length > MAX_PDF_BYTES)
      throw new BadRequestException('O PDF deve ter até 5 MB.');

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        fullName: true,
        studentNumber: true,
        course: true,
        institutionalEmailVerifiedAt: true,
        academicVerification: { select: { status: true } },
      },
    });
    if (!user.institutionalEmailVerifiedAt)
      throw new ConflictException('Verifique seu e-mail institucional antes de enviar o PDF.');
    if (!user.studentNumber || !user.course)
      throw new ConflictException('Cadastre sua matrícula e seu curso antes de enviar o PDF.');
    if (
      user.academicVerification?.status === AcademicVerificationStatus.PENDING_REVIEW ||
      user.academicVerification?.status === AcademicVerificationStatus.APPROVED
    )
      throw new ConflictException('Já existe uma validação pendente ou aprovada.');

    const reportGuid = await extractAndValidateReport(file.buffer, {
      fullName: user.fullName,
      studentNumber: user.studentNumber,
      course: user.course,
    });

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
  }

  async listPendingReviews(skip: number, take: number) {
    return this.prisma.academicVerification.findMany({
      where: { status: AcademicVerificationStatus.PENDING_REVIEW },
      include: {
        user: {
          select: {
            fullName: true,
            institutionalEmail: true,
            studentNumber: true,
            course: true,
          },
        },
      },
      orderBy: { submittedAt: 'asc' },
      skip,
      take,
    });
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
      if (!update.count) throw new NotFoundException('Validação pendente não encontrada.');
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

  private emailConfiguration() {
    const apiKey = this.config.get<string>('email.resendApiKey');
    const from = this.config.get<string>('email.from');
    const hmacSecret = this.config.get<string>('auth.emailVerificationSecret');
    if (!apiKey || !from)
      throw new ServiceUnavailableException(
        'O envio de e-mail ainda não está configurado. Tente novamente mais tarde.',
      );
    if (!hmacSecret || hmacSecret.length < 32)
      throw new ServiceUnavailableException('A verificação de e-mail não está configurada.');
    return { apiKey, from, hmacSecret };
  }

  private async reserveCode(
    userId: string,
    codeHash: string,
    expiresAt: Date,
    resendAvailableAt: Date,
    now: Date,
  ) {
    try {
      await this.prisma.emailVerificationChallenge.create({
        data: { userId, codeHash, expiresAt, resendAvailableAt, attempts: 0 },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
        throw error;
      const updated = await this.prisma.emailVerificationChallenge.updateMany({
        where: { userId, resendAvailableAt: { lte: now } },
        data: { codeHash, expiresAt, resendAvailableAt, attempts: 0, createdAt: now },
      });
      if (!updated.count) {
        const latest = await this.prisma.emailVerificationChallenge.findUniqueOrThrow({
          where: { userId },
          select: { resendAvailableAt: true },
        });
        throw this.resendCooldown(latest.resendAvailableAt, now);
      }
    }
  }

  private async sendResendEmail(apiKey: string, from: string, to: string, code: string) {
    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject: 'Código de verificação UniMove',
          text: `Seu código de verificação é ${code}. Ele expira em 10 minutos. Não compartilhe este código.`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      this.logger.error(
        'Falha de comunicação com o serviço de e-mail.',
        error instanceof Error ? error.message : undefined,
      );
      throw new ServiceUnavailableException(
        'Não foi possível enviar o e-mail de verificação. Tente novamente em um minuto.',
      );
    }
    if (!response.ok) {
      this.logger.error(`O serviço de e-mail respondeu com HTTP ${response.status}.`);
      throw new ServiceUnavailableException(
        'Não foi possível enviar o e-mail de verificação. Tente novamente em um minuto.',
      );
    }
  }

  private resendCooldown(resendAvailableAt: Date, now: Date) {
    const seconds = Math.max(1, Math.ceil((resendAvailableAt.getTime() - now.getTime()) / 1000));
    return new HttpException(
      `Solicite outro código em ${seconds} segundo${seconds === 1 ? '' : 's'}.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

function createUniqueDigitCode() {
  let code = String(randomInt(1, 10));
  while (code.length < CODE_LENGTH) {
    const digit = String(randomInt(0, 10));
    if (!code.includes(digit)) code += digit;
  }
  return code;
}

function hashCode(secret: string, userId: string, code: string) {
  return createHmac('sha256', secret).update(`${userId}:${code}`).digest('hex');
}

async function extractAndValidateReport(
  buffer: Buffer,
  expected: { fullName: string; studentNumber: string; course: string },
) {
  let text: string;
  const parser = new PDFParse({ data: new Uint8Array(buffer), stopAtErrors: true });
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
