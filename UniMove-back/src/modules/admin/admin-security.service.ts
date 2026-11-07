import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../../database/prisma.service';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { SessionScope } from '../../generated/prisma/enums';
import { AuthAttemptLimiter } from '../auth/auth-attempt-limiter';
import { decryptTwoFactorSecret, encryptTwoFactorSecret } from '../auth/two-factor-crypto';
import { adminPasswordChangedEmail } from '../mail/admin-mail.templates';
import { MailService } from '../mail/mail.service';
import { AdminReauthService } from './admin-reauth.service';
import {
  buildRecoveryCodes,
  matchesTotp,
  provisionFactor,
  RECOVERY_CODE_COUNT,
  TWO_FACTOR_ISSUER,
} from './admin-two-factor';
import type { ChangeOwnPasswordDto, ConfirmAuthenticatorDto, ReauthDto } from './admin-iam.dto';

const SETUP_TICKET_TTL_SECONDS = 10 * 60;

interface FactorSetupTicket {
  sub: string;
  type: 'admin_factor_setup';
  /** Segredo novo cifrado com a chave do servidor: o ticket sozinho não o entrega. */
  secret: string;
  /** Versão do fator anterior, para impedir replay do ticket após a substituição. */
  factorVersion: string;
}

/**
 * Segurança da própria conta administrativa: resumo, troca de senha, novos
 * códigos de recuperação e substituição do autenticador.
 *
 * Diferente de AdminRecoveryService, que atende quem **perdeu** o acesso e por
 * isso passa por e-mail e aprovação de outro administrador. Aqui a pessoa está
 * autenticada e reautentica na hora, então não há e-mail nem aprovação.
 *
 * O autenticador novo vive num ticket assinado de dez minutos, não no banco: o
 * fator atual só é substituído no instante em que o código novo é confirmado.
 * Sem isso existiria uma janela em que a conta não teria segundo fator nenhum,
 * e uma desistência no meio do caminho trancaria a pessoa fora do painel.
 */
@Injectable()
export class AdminSecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly reauth: AdminReauthService,
    private readonly limiter: AuthAttemptLimiter,
    private readonly mail: MailService,
  ) {}

  /** Tudo que "Minha conta" e "Segurança da conta" mostram, em uma chamada. */
  async overview(actor: AuthUser) {
    const now = new Date();
    const [account, lastLogin, passwordChanged, factorEnrolled] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: actor.id },
        select: {
          id: true,
          fullName: true,
          institutionalEmail: true,
          status: true,
          createdAt: true,
          roles: { select: { role: { select: { name: true } } } },
          adminAccess: { select: { permissions: true, updatedAt: true } },
          twoFactor: { select: { enabled: true, recoveryCodes: true, updatedAt: true } },
          refreshSessions: {
            where: { scope: SessionScope.ADMIN, revokedAt: null, expiresAt: { gt: now } },
            select: { id: true, userAgent: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
      this.lastAudit(actor.id, ['ADMIN_LOGIN']),
      this.lastAudit(actor.id, ['ADMIN_PASSWORD_CHANGED', 'ADMIN_PASSWORD_RESET_COMPLETED']),
      this.lastAudit(actor.id, [
        'ADMIN_2FA_ENROLLED',
        'ADMIN_2FA_REPLACED',
        'ADMIN_MFA_RECOVERY_COMPLETED',
      ]),
    ]);
    const current = account.refreshSessions.find((session) => session.id === actor.sid);
    return {
      account: {
        id: account.id,
        fullName: account.fullName,
        email: account.institutionalEmail,
        status: account.status,
        roles: account.roles.map((item) => item.role.name),
        permissions: account.adminAccess?.permissions ?? [],
        permissionsUpdatedAt: account.adminAccess?.updatedAt ?? null,
        createdAt: account.createdAt,
      },
      twoFactor: {
        enabled: account.twoFactor?.enabled === true,
        recoveryCodesRemaining: account.twoFactor?.recoveryCodes.length ?? 0,
        recoveryCodesTotal: RECOVERY_CODE_COUNT,
        issuer: TWO_FACTOR_ISSUER,
        // Data do evento de auditoria quando existe; a linha do fator é o reserva.
        boundAt: factorEnrolled ?? account.twoFactor?.updatedAt ?? null,
      },
      password: {
        // Null quando nunca foi trocada por aqui. A tela diz isso, não inventa data.
        changedAt: passwordChanged,
      },
      sessions: {
        active: account.refreshSessions.length,
        others: Math.max(0, account.refreshSessions.length - (current ? 1 : 0)),
        currentStartedAt: current?.createdAt ?? null,
        currentUserAgent: current?.userAgent ?? null,
      },
      lastLoginAt: lastLogin,
      sessionMaxHours: this.config.get<number>('admin.sessionMaxHours') ?? 12,
    };
  }

  async changePassword(actor: AuthUser, dto: ChangeOwnPasswordDto) {
    const limitKey = `admin-password-change:${actor.id}`;
    await this.limiter.assertAllowed(limitKey);
    const account = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: { id: true, fullName: true, institutionalEmail: true, passwordHash: true },
    });
    if (!(await argon2.verify(account.passwordHash, dto.currentPassword))) {
      await this.limiter.recordFailure(limitKey);
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Senha atual incorreta.',
      });
    }
    if (await argon2.verify(account.passwordHash, dto.password))
      throw new ConflictException({
        code: 'PASSWORD_UNCHANGED',
        message: 'A nova senha precisa ser diferente da atual.',
      });
    await this.limiter.reset(limitKey);

    const revoked = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: actor.id },
        data: { passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }) },
      });
      // A sessão atual fica: quem acabou de provar a senha não precisa entrar
      // de novo. As outras caem, que é a razão de trocar senha.
      const { count } = await tx.refreshSession.updateMany({
        where: {
          userId: actor.id,
          revokedAt: null,
          ...(actor.sid ? { id: { not: actor.sid } } : {}),
        },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'ADMIN_PASSWORD_CHANGED',
          entityType: 'User',
          entityId: actor.id,
          metadata: { sessionsRevoked: count },
        },
      });
      return count;
    });
    const delivery = await this.mail.send(
      adminPasswordChangedEmail({
        to: account.institutionalEmail,
        fullName: account.fullName,
        changedAt: new Date(),
      }),
    );
    return { updated: true, sessionsRevoked: revoked, delivery };
  }

  /** Lote novo invalida o anterior. Exibido uma única vez, aqui. */
  async regenerateRecoveryCodes(actor: AuthUser, dto: ReauthDto) {
    await this.reauth.assertReauthenticated(actor.id, dto);
    const { codes, hashes } = await buildRecoveryCodes();
    const { count } = await this.prisma.twoFactorAuth.updateMany({
      where: { userId: actor.id, enabled: true },
      data: { recoveryCodes: hashes },
    });
    if (!count)
      throw new ConflictException({
        code: 'TWO_FACTOR_NOT_ENABLED',
        message: 'Ative o segundo fator antes de gerar códigos de recuperação.',
      });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: 'ADMIN_RECOVERY_CODES_REGENERATED',
        entityType: 'User',
        entityId: actor.id,
        metadata: { issued: codes.length },
      },
    });
    return { recoveryCodes: codes, remaining: codes.length };
  }

  async startAuthenticatorReplacement(actor: AuthUser, dto: ReauthDto) {
    await this.reauth.assertReauthenticated(actor.id, dto);
    const account = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: {
        institutionalEmail: true,
        twoFactor: { select: { enabled: true, updatedAt: true } },
      },
    });
    if (account.twoFactor?.enabled !== true)
      throw new ConflictException({
        code: 'TWO_FACTOR_NOT_ENABLED',
        message: 'Não há segundo fator ativo para substituir.',
      });
    const factor = await provisionFactor(account.institutionalEmail);
    // O fator atual continua valendo até a confirmação: nada é gravado aqui.
    const setupTicket = await this.jwt.signAsync(
      {
        sub: actor.id,
        type: 'admin_factor_setup',
        secret: factor.encryptedSecret,
        factorVersion: account.twoFactor.updatedAt.toISOString(),
      },
      {
        secret: this.config.getOrThrow('auth.accessSecret'),
        expiresIn: SETUP_TICKET_TTL_SECONDS,
      },
    );
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: 'ADMIN_2FA_REPLACEMENT_STARTED',
        entityType: 'User',
        entityId: actor.id,
      },
    });
    return {
      setupTicket,
      expiresInMs: SETUP_TICKET_TTL_SECONDS * 1000,
      twoFactor: {
        secret: factor.secret,
        otpauthUri: factor.otpauthUri,
        qrCode: factor.qrCode,
        issuer: TWO_FACTOR_ISSUER,
      },
    };
  }

  async confirmAuthenticatorReplacement(actor: AuthUser, dto: ConfirmAuthenticatorDto) {
    const limitKey = `admin-factor-replace:${actor.id}`;
    await this.limiter.assertAllowed(limitKey);
    let ticket: FactorSetupTicket | undefined;
    try {
      ticket = await this.jwt.verifyAsync<FactorSetupTicket>(dto.setupTicket, {
        secret: this.config.getOrThrow('auth.accessSecret'),
      });
    } catch {
      ticket = undefined;
    }
    if (
      ticket?.type !== 'admin_factor_setup' ||
      ticket.sub !== actor.id ||
      !ticket.factorVersion ||
      !Number.isFinite(Date.parse(ticket.factorVersion))
    )
      throw new UnauthorizedException({
        code: 'ADMIN_FACTOR_SETUP_EXPIRED',
        message: 'O cadastro do autenticador expirou. Comece de novo.',
      });

    const factorVersion = new Date(ticket.factorVersion);
    const { secret } = decryptTwoFactorSecret(ticket.secret);
    const code = dto.code.trim();
    if (!(await matchesTotp(secret, code)) || !(await this.limiter.claimCode(actor.id, code))) {
      await this.limiter.recordFailure(limitKey);
      throw new UnauthorizedException({
        code: 'INVALID_CODE',
        message: 'Código do autenticador novo incorreto. Confira o aplicativo.',
      });
    }
    await this.limiter.reset(limitKey);

    const { codes, hashes } = await buildRecoveryCodes();
    return this.prisma.$transaction(async (tx) => {
      // enabled: true na condição garante que ainda havia fator a substituir.
      const { count } = await tx.twoFactorAuth.updateMany({
        where: {
          userId: actor.id,
          enabled: true,
          // Compare-and-swap: o ticket só vale para a versão anterior do fator.
          // Após uma primeira confirmação, a versão muda e qualquer replay falha.
          updatedAt: factorVersion,
        },
        data: { secret: encryptTwoFactorSecret(secret), recoveryCodes: hashes },
      });
      if (!count)
        throw new ConflictException({
          code: 'ADMIN_FACTOR_SETUP_STALE',
          message: 'O autenticador mudou desde o início da configuração. Comece de novo.',
        });
      // O fator antigo deixa de validar novos logins. As demais sessões
      // administrativas devem cair, sem encerrar a sessão que concluiu a troca.
      const { count: sessionsRevoked } = await tx.refreshSession.updateMany({
        where: {
          userId: actor.id,
          scope: SessionScope.ADMIN,
          revokedAt: null,
          ...(actor.sid ? { id: { not: actor.sid } } : {}),
        },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'ADMIN_2FA_REPLACED',
          entityType: 'User',
          entityId: actor.id,
          metadata: { sessionsRevoked },
        },
      });
      // Códigos antigos morreram com o fator antigo: os novos saem agora, uma vez.
      return { replaced: true, recoveryCodes: codes, sessionsRevoked };
    });
  }

  private async lastAudit(userId: string, actions: string[]) {
    const entry = await this.prisma.auditLog.findFirst({
      where: { actorUserId: userId, action: { in: actions } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return entry?.createdAt ?? null;
  }
}
