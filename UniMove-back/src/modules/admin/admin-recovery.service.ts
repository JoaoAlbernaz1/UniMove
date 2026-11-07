import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import type { Prisma } from '../../generated/prisma/client';
import {
  AdminPermission,
  AdminRecoveryStatus,
  RoleName,
  UserStatus,
} from '../../generated/prisma/enums';
import { AuthAttemptLimiter } from '../auth/auth-attempt-limiter';
import { decryptTwoFactorSecret } from '../auth/two-factor-crypto';
import {
  adminMfaRecoveryApprovedEmail,
  adminMfaRecoveryRejectedEmail,
  adminMfaRecoveryRequestedEmail,
  adminPasswordChangedEmail,
  adminPasswordResetEmail,
} from '../mail/admin-mail.templates';
import { MailService } from '../mail/mail.service';
import { buildPanelUrl, hashToken, issueToken } from './admin-tokens';
import { buildRecoveryCodes, matchesTotp, provisionFactor } from './admin-two-factor';
import { AdminReauthService } from './admin-reauth.service';
import type {
  AdminRecoveriesQueryDto,
  ConfirmMfaRecoveryDto,
  ConfirmPasswordResetDto,
  RequestMfaRecoveryDto,
  RequestPasswordResetDto,
  ReviewMfaRecoveryDto,
  StartMfaRecoveryDto,
} from './admin-iam.dto';

/** Resposta única do pedido de redefinição: não revela se a conta existe. */
const NEUTRAL_REQUEST = {
  accepted: true,
  message: 'Se houver uma conta administrativa com este e-mail, enviaremos as instruções.',
};

const INVALID_TOKEN = {
  code: 'ADMIN_TOKEN_INVALID',
  message: 'Link inválido, expirado ou já utilizado. Solicite um novo.',
};

@Injectable()
export class AdminRecoveryService {
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly limiter: AuthAttemptLimiter,
    private readonly reauth: AdminReauthService,
  ) {}

  // ------------------------------------------------- recuperação de senha

  async requestPasswordReset(dto: RequestPasswordResetDto) {
    const email = dto.email.trim().toLowerCase();
    // O limite é por e-mail e não distingue conta existente de inexistente,
    // então o tempo de resposta também não vira oráculo de enumeração.
    const limitKey = `admin-reset:${email}`;
    await this.limiter.assertAllowed(limitKey);
    await this.limiter.recordFailure(limitKey);

    const account = await this.prisma.user.findUnique({
      where: { institutionalEmail: email },
      select: {
        id: true,
        fullName: true,
        institutionalEmail: true,
        status: true,
        deletedAt: true,
        roles: { select: { role: { select: { name: true } } } },
      },
    });
    const eligible =
      account &&
      account.status === UserStatus.ACTIVE &&
      !account.deletedAt &&
      account.roles.some((item) => item.role.name === RoleName.ADMIN);
    if (!eligible) {
      // Mesmo custo de hash de uma conta real, para não vazar por tempo.
      this.dummyHash ??= argon2.hash(randomBytes(32).toString('hex'), { type: argon2.argon2id });
      await this.dummyHash;
      return NEUTRAL_REQUEST;
    }

    const ttlMinutes = this.config.get<number>('admin.passwordResetTtlMinutes') ?? 30;
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    const { token, tokenHash } = issueToken();
    await this.prisma.$transaction(async (tx) => {
      // Pedido novo invalida os anteriores: só o último link funciona.
      await tx.adminPasswordReset.updateMany({
        where: { userId: account.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.adminPasswordReset.create({
        data: { userId: account.id, tokenHash, expiresAt },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: account.id,
          action: 'ADMIN_PASSWORD_RESET_REQUESTED',
          entityType: 'User',
          entityId: account.id,
          metadata: { expiresAt: expiresAt.toISOString() },
        },
      });
    });
    await this.mail.send(
      adminPasswordResetEmail({
        to: account.institutionalEmail,
        fullName: account.fullName,
        url: buildPanelUrl(this.panelUrl(), 'redefinir-senha', token),
        expiresAt,
      }),
    );
    return NEUTRAL_REQUEST;
  }

  async confirmPasswordReset(dto: ConfirmPasswordResetDto) {
    const tokenHash = await this.readToken(dto.token, 'reset');
    const account = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM admin_password_resets WHERE token_hash = ${tokenHash} FOR UPDATE`;
      const reset = await tx.adminPasswordReset.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          usedAt: true,
          expiresAt: true,
          user: {
            select: {
              id: true,
              fullName: true,
              institutionalEmail: true,
              status: true,
              deletedAt: true,
              roles: { select: { role: { select: { name: true } } } },
            },
          },
        },
      });
      if (
        !reset ||
        reset.usedAt ||
        reset.expiresAt <= new Date() ||
        reset.user.deletedAt ||
        reset.user.status !== UserStatus.ACTIVE ||
        !reset.user.roles.some((item) => item.role.name === RoleName.ADMIN)
      )
        throw new UnauthorizedException(INVALID_TOKEN);

      // Uso único: a condição usedAt null é o que fecha a corrida.
      const consumed = await tx.adminPasswordReset.updateMany({
        where: { id: reset.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (!consumed.count) throw new UnauthorizedException(INVALID_TOKEN);

      await tx.user.update({
        where: { id: reset.user.id },
        data: { passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }) },
      });
      // Senha trocada derruba tudo, painel e aplicativo: a credencial é a mesma.
      await tx.refreshSession.updateMany({
        where: { userId: reset.user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: reset.user.id,
          action: 'ADMIN_PASSWORD_RESET_COMPLETED',
          entityType: 'User',
          entityId: reset.user.id,
        },
      });
      return reset.user;
    });
    await this.mail.send(
      adminPasswordChangedEmail({
        to: account.institutionalEmail,
        fullName: account.fullName,
        changedAt: new Date(),
      }),
    );
    // O segundo fator não foi tocado: continua obrigatório no próximo login.
    return { updated: true, twoFactorStillRequired: true };
  }

  // ------------------------------------- recuperação do segundo fator

  async requestMfaRecovery(dto: RequestMfaRecoveryDto) {
    const email = dto.email.trim().toLowerCase();
    const limitKey = `admin-mfa-recovery:${email}`;
    await this.limiter.assertAllowed(limitKey);
    await this.limiter.recordFailure(limitKey);

    const account = await this.prisma.user.findUnique({
      where: { institutionalEmail: email },
      select: {
        id: true,
        fullName: true,
        institutionalEmail: true,
        passwordHash: true,
        status: true,
        deletedAt: true,
        roles: { select: { role: { select: { name: true } } } },
      },
    });
    this.dummyHash ??= argon2.hash(randomBytes(32).toString('hex'), { type: argon2.argon2id });
    // A senha é obrigatória de propósito: só o acesso ao e-mail nunca derruba o
    // segundo fator.
    const passwordMatches = await argon2.verify(
      account?.passwordHash ?? (await this.dummyHash),
      dto.password,
    );
    const eligible =
      account &&
      passwordMatches &&
      account.status === UserStatus.ACTIVE &&
      !account.deletedAt &&
      account.roles.some((item) => item.role.name === RoleName.ADMIN);
    if (!eligible) return NEUTRAL_REQUEST;

    const ttlHours = this.config.get<number>('admin.mfaRecoveryTtlHours') ?? 24;
    const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);
    try {
      const request = await this.prisma.adminMfaRecovery.create({
        data: { userId: account.id, reason: dto.reason.trim(), expiresAt },
        select: { id: true },
      });
      await this.prisma.auditLog.create({
        data: {
          actorUserId: account.id,
          action: 'ADMIN_MFA_RECOVERY_REQUESTED',
          entityType: 'AdminMfaRecovery',
          entityId: request.id,
          metadata: { expiresAt: expiresAt.toISOString() },
        },
      });
      await this.notifyReviewers(
        account.id,
        account.fullName,
        account.institutionalEmail,
        dto.reason,
      );
    } catch (error) {
      // Índice parcial admin_mfa_recoveries_open_key: já existe pedido em aberto.
      if (!isUniqueViolation(error)) throw error;
    }
    return NEUTRAL_REQUEST;
  }

  async listRecoveries(query: AdminRecoveriesQueryDto) {
    const where: Prisma.AdminMfaRecoveryWhereInput = query.status ? { status: query.status } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.adminMfaRecovery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          status: true,
          reason: true,
          expiresAt: true,
          reviewedAt: true,
          reviewNote: true,
          completedAt: true,
          createdAt: true,
          user: { select: { id: true, fullName: true, institutionalEmail: true } },
          reviewedBy: { select: { id: true, fullName: true } },
        },
      }),
      this.prisma.adminMfaRecovery.count({ where }),
    ]);
    const now = new Date();
    return {
      items: items.map((item) => ({
        ...item,
        expired:
          (item.status === AdminRecoveryStatus.PENDING ||
            item.status === AdminRecoveryStatus.APPROVED) &&
          item.expiresAt <= now,
      })),
      total,
    };
  }

  async reviewMfaRecovery(actor: AuthUser, id: string, dto: ReviewMfaRecoveryDto) {
    await this.reauth.assertReauthenticated(actor.id, dto);
    const { token, request, reviewerName } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM admin_mfa_recoveries WHERE id = ${id}::uuid FOR UPDATE`;
      const found = await tx.adminMfaRecovery.findUnique({
        where: { id },
        select: {
          id: true,
          userId: true,
          status: true,
          expiresAt: true,
          user: { select: { fullName: true, institutionalEmail: true } },
        },
      });
      if (!found) throw new NotFoundException('Pedido de recuperação não encontrado.');
      // Ninguém aprova o próprio pedido: é o ponto da supervisão.
      if (found.userId === actor.id)
        throw new ConflictException({
          code: 'CANNOT_REVIEW_OWN_RECOVERY',
          message: 'Outro administrador autorizado precisa revisar o seu pedido.',
        });
      if (found.status !== AdminRecoveryStatus.PENDING)
        throw new ConflictException({
          code: 'RECOVERY_NOT_PENDING',
          message: 'Este pedido já foi revisado. Atualize a página.',
        });
      if (found.expiresAt <= new Date())
        throw new ConflictException({
          code: 'RECOVERY_EXPIRED',
          message: 'Este pedido expirou. O administrador precisa abrir outro.',
        });

      const reviewer = await tx.user.findUnique({
        where: { id: actor.id },
        select: { fullName: true },
      });
      if (!dto.approve) {
        await tx.adminMfaRecovery.update({
          where: { id },
          data: {
            status: AdminRecoveryStatus.REJECTED,
            reviewedById: actor.id,
            reviewedAt: new Date(),
            reviewNote: dto.note ?? null,
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: 'ADMIN_MFA_RECOVERY_REJECTED',
            entityType: 'AdminMfaRecovery',
            entityId: id,
            metadata: { subjectUserId: found.userId },
          },
        });
        return {
          token: undefined,
          request: found,
          reviewerName: reviewer?.fullName ?? 'Um administrador',
        };
      }

      const issued = issueToken();
      const approved = await tx.adminMfaRecovery.updateMany({
        where: { id, status: AdminRecoveryStatus.PENDING },
        data: {
          status: AdminRecoveryStatus.APPROVED,
          reviewedById: actor.id,
          reviewedAt: new Date(),
          reviewNote: dto.note ?? null,
          tokenHash: issued.tokenHash,
        },
      });
      if (!approved.count)
        throw new ConflictException({
          code: 'RECOVERY_NOT_PENDING',
          message: 'Este pedido já foi revisado. Atualize a página.',
        });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'ADMIN_MFA_RECOVERY_APPROVED',
          entityType: 'AdminMfaRecovery',
          entityId: id,
          metadata: { subjectUserId: found.userId },
        },
      });
      return {
        token: issued.token,
        request: found,
        reviewerName: reviewer?.fullName ?? 'Um administrador',
      };
    });

    const delivery = token
      ? await this.mail.send(
          adminMfaRecoveryApprovedEmail({
            to: request.user.institutionalEmail,
            fullName: request.user.fullName,
            url: buildPanelUrl(this.panelUrl(), 'recuperar-autenticador', token),
            expiresAt: request.expiresAt,
            reviewedBy: reviewerName,
          }),
        )
      : await this.mail.send(
          adminMfaRecoveryRejectedEmail({
            to: request.user.institutionalEmail,
            fullName: request.user.fullName,
            reviewedBy: reviewerName,
            note: dto.note,
          }),
        );
    return { reviewed: true, approved: dto.approve, delivery };
  }

  /** Invalida o fator anterior e provisiona um novo. Exige a senha outra vez. */
  async startMfaRecovery(dto: StartMfaRecoveryDto) {
    const tokenHash = await this.readToken(dto.token, 'mfa');
    return this.prisma.$transaction(async (tx) => {
      const request = await this.loadApproved(tx, tokenHash);
      const account = await tx.user.findUniqueOrThrow({
        where: { id: request.userId },
        select: { id: true, institutionalEmail: true, passwordHash: true },
      });
      const limitKey = `admin-mfa-recovery-confirm:${account.id}`;
      await this.limiter.assertAllowed(limitKey);
      if (!(await argon2.verify(account.passwordHash, dto.password))) {
        await this.limiter.recordFailure(limitKey);
        throw new UnauthorizedException({
          code: 'INVALID_CREDENTIALS',
          message: 'Senha incorreta.',
        });
      }
      await this.limiter.reset(limitKey);

      // Fator antigo e códigos antigos deixam de valer agora, não ao confirmar:
      // quem chegou até aqui provou senha e aprovação de outro administrador.
      const factor = await provisionFactor(account.institutionalEmail);
      await tx.twoFactorAuth.upsert({
        where: { userId: account.id },
        create: { userId: account.id, secret: factor.encryptedSecret, enabled: false },
        update: { secret: factor.encryptedSecret, enabled: false, recoveryCodes: [] },
      });
      await tx.refreshSession.updateMany({
        where: { userId: account.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: account.id,
          action: 'ADMIN_MFA_RECOVERY_STARTED',
          entityType: 'AdminMfaRecovery',
          entityId: request.id,
        },
      });
      return {
        twoFactor: {
          secret: factor.secret,
          otpauthUri: factor.otpauthUri,
          qrCode: factor.qrCode,
        },
      };
    });
  }

  async confirmMfaRecovery(dto: ConfirmMfaRecoveryDto) {
    const tokenHash = await this.readToken(dto.token, 'mfa');
    return this.prisma.$transaction(async (tx) => {
      const request = await this.loadApproved(tx, tokenHash);
      const limitKey = `admin-mfa-recovery-code:${request.userId}`;
      await this.limiter.assertAllowed(limitKey);
      const factor = await tx.twoFactorAuth.findUnique({
        where: { userId: request.userId },
        select: { secret: true, enabled: true },
      });
      if (!factor || factor.enabled)
        throw new ConflictException({
          code: 'RECOVERY_FACTOR_MISSING',
          message: 'Reinicie o cadastro do autenticador para continuar.',
        });
      const { secret } = decryptTwoFactorSecret(factor.secret);
      const code = dto.code.trim();
      if (
        !(await matchesTotp(secret, code)) ||
        !(await this.limiter.claimCode(request.userId, code))
      ) {
        await this.limiter.recordFailure(limitKey);
        throw new UnauthorizedException({
          code: 'INVALID_CODE',
          message: 'Código de autenticação inválido.',
        });
      }

      const { codes, hashes } = await buildRecoveryCodes();
      const enabled = await tx.twoFactorAuth.updateMany({
        where: { userId: request.userId, enabled: false, secret: factor.secret },
        data: { enabled: true, recoveryCodes: hashes },
      });
      if (!enabled.count)
        throw new ConflictException({
          code: 'RECOVERY_FACTOR_CHANGED',
          message: 'O cadastro do autenticador mudou. Reinicie o processo.',
        });
      const completed = await tx.adminMfaRecovery.updateMany({
        where: { id: request.id, status: AdminRecoveryStatus.APPROVED },
        data: { status: AdminRecoveryStatus.COMPLETED, completedAt: new Date() },
      });
      if (!completed.count) throw new UnauthorizedException(INVALID_TOKEN);
      await tx.refreshSession.updateMany({
        where: { userId: request.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: request.userId,
          action: 'ADMIN_MFA_RECOVERY_COMPLETED',
          entityType: 'AdminMfaRecovery',
          entityId: request.id,
        },
      });
      await this.limiter.reset(limitKey);
      return { completed: true, recoveryCodes: codes };
    });
  }

  // -------------------------------------------------------------- privados

  private async notifyReviewers(
    subjectUserId: string,
    subjectName: string,
    subjectEmail: string,
    reason: string,
  ) {
    const reviewers = await this.prisma.user.findMany({
      where: {
        id: { not: subjectUserId },
        status: UserStatus.ACTIVE,
        deletedAt: null,
        roles: { some: { role: { name: RoleName.ADMIN } } },
        twoFactor: { is: { enabled: true } },
        adminAccess: { is: { permissions: { has: AdminPermission.MANAGE_ADMINS } } },
      },
      select: { fullName: true, institutionalEmail: true },
      take: 20,
    });
    const url = new URL('seguranca', this.panelUrlWithSlash()).toString();
    for (const reviewer of reviewers) {
      await this.mail.send(
        adminMfaRecoveryRequestedEmail({
          to: reviewer.institutionalEmail,
          reviewerName: reviewer.fullName,
          subjectName,
          subjectEmail,
          reason,
          url,
        }),
      );
    }
  }

  private async loadApproved(tx: Prisma.TransactionClient, tokenHash: string) {
    await tx.$queryRaw`SELECT id FROM admin_mfa_recoveries WHERE token_hash = ${tokenHash} FOR UPDATE`;
    const request = await tx.adminMfaRecovery.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, status: true, expiresAt: true },
    });
    if (
      !request ||
      request.status !== AdminRecoveryStatus.APPROVED ||
      request.expiresAt <= new Date()
    )
      throw new UnauthorizedException(INVALID_TOKEN);
    return request;
  }

  private async readToken(token: string, kind: 'reset' | 'mfa') {
    const value = token?.trim();
    if (!value || value.length < 20 || value.length > 200)
      throw new UnauthorizedException(INVALID_TOKEN);
    const tokenHash = hashToken(value);
    await this.limiter.assertAllowed(`admin-${kind}-token:${tokenHash.slice(0, 32)}`);
    return tokenHash;
  }

  private panelUrl() {
    const url = this.config.get<string>('admin.panelUrl');
    if (!url)
      throw new ConflictException({
        code: 'ADMIN_PANEL_URL_MISSING',
        message: 'Configure ADMIN_PANEL_URL para enviar links do painel.',
      });
    return url;
  }

  private panelUrlWithSlash() {
    const url = this.panelUrl();
    return url.endsWith('/') ? url : `${url}/`;
  }
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
