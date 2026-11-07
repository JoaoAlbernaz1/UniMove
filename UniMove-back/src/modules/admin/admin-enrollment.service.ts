import {
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { RoleName, UserStatus } from '../../generated/prisma/enums';
import { AuthAttemptLimiter } from '../auth/auth-attempt-limiter';
import {
  decryptTwoFactorSecret,
  encryptTwoFactorSecret,
  isTwoFactorKeyConfigured,
} from '../auth/two-factor-crypto';
import {
  buildRecoveryCodes,
  matchesTotp,
  provisionFactor,
  TWO_FACTOR_ISSUER,
} from './admin-two-factor';

/** Operator-only API. Never expose this provider through an HTTP controller. */
@Injectable()
export class AdminEnrollmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limiter: AuthAttemptLimiter,
  ) {}

  async begin(emailInput: string) {
    this.assertDedicatedKey();
    const email = emailInput.trim().toLowerCase();
    const factor = await provisionFactor(email);
    await this.prisma.$transaction(async (tx) => {
      const account = await this.lockAccount(tx, email);
      await tx.twoFactorAuth.upsert({
        where: { userId: account.id },
        create: { userId: account.id, secret: factor.encryptedSecret, enabled: false },
        update: { secret: factor.encryptedSecret, recoveryCodes: [] },
      });
      await this.audit(tx, account.id, 'ADMIN_2FA_ENROLLMENT_STARTED');
    });
    return { secret: factor.secret, qrCode: factor.qrCode, issuer: TWO_FACTOR_ISSUER };
  }

  async confirm(emailInput: string, codeInput: string) {
    this.assertDedicatedKey();
    const email = emailInput.trim().toLowerCase();
    const code = codeInput.trim();
    return this.prisma.$transaction(async (tx) => {
      const account = await this.lockAccount(tx, email);
      const factor = account.twoFactor;
      if (!factor) throw new UnauthorizedException('Inicie o provisionamento antes de confirmar.');
      const limitKey = `2fa:${account.id}`;
      await this.limiter.assertAllowed(limitKey);
      const { secret } = decryptTwoFactorSecret(factor.secret);
      if (!(await matchesTotp(secret, code)) || !(await this.limiter.claimCode(account.id, code))) {
        await this.limiter.recordFailure(limitKey);
        throw new UnauthorizedException('Código de autenticação inválido.');
      }
      const { codes, hashes } = await buildRecoveryCodes();
      const { count } = await tx.twoFactorAuth.updateMany({
        where: { userId: account.id, enabled: false, secret: factor.secret },
        data: { enabled: true, secret: encryptTwoFactorSecret(secret), recoveryCodes: hashes },
      });
      if (!count) throw new ConflictException('O provisionamento mudou. Inicie novamente.');
      await this.audit(tx, account.id, 'ADMIN_2FA_ENROLLED');
      await this.limiter.reset(limitKey);
      return { recoveryCodes: codes };
    });
  }

  /**
   * Procedimento emergencial para o último administrador: apaga o fator atual
   * para que `begin` possa provisionar outro. Existe somente aqui, chamado pela
   * CLI do operador, e nunca por HTTP — o caminho supervisionado pelo painel é
   * AdminRecoveryService, que exige a aprovação de outro administrador.
   */
  async resetFactor(emailInput: string) {
    this.assertDedicatedKey();
    const email = emailInput.trim().toLowerCase();
    return this.prisma.$transaction(async (tx) => {
      // Mesmo lock de linha do provisionamento, mas sem recusar fator já ativo:
      // apagar um fator ativo é exatamente o objetivo aqui.
      await tx.$queryRaw`SELECT id FROM users WHERE institutional_email = ${email} FOR UPDATE`;
      const account = await tx.user.findUnique({
        where: { institutionalEmail: email },
        select: {
          id: true,
          status: true,
          deletedAt: true,
          roles: { select: { role: { select: { name: true } } } },
          twoFactor: { select: { enabled: true } },
        },
      });
      if (
        !account ||
        account.status !== UserStatus.ACTIVE ||
        account.deletedAt ||
        !account.roles.some((item) => item.role.name === RoleName.ADMIN)
      )
        throw new ForbiddenException('A recuperação emergencial exige uma conta ADMIN ativa.');
      if (!account.twoFactor)
        throw new ConflictException('Esta conta não tem segundo fator para recuperar.');
      // Apagar a linha derruba o segredo e todos os códigos de recuperação.
      await tx.twoFactorAuth.deleteMany({ where: { userId: account.id } });
      await tx.refreshSession.updateMany({
        where: { userId: account.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit(tx, account.id, 'ADMIN_2FA_RESET_BY_OPERATOR');
      return { reset: true, email };
    });
  }

  private assertDedicatedKey() {
    if (!isTwoFactorKeyConfigured())
      throw new ServiceUnavailableException({
        code: 'TWO_FACTOR_KEY_MISSING',
        message:
          'Configure a chave dedicada de segundo fator antes de provisionar um administrador.',
      });
  }

  private async lockAccount(tx: Prisma.TransactionClient, email: string) {
    // Serializa begin/confirm para esta conta e as alterações de status/exclusão.
    await tx.$queryRaw`SELECT id FROM users WHERE institutional_email = ${email} FOR UPDATE`;
    const account = await tx.user.findUnique({
      where: { institutionalEmail: email },
      select: {
        id: true,
        status: true,
        deletedAt: true,
        roles: { select: { role: { select: { name: true } } } },
        twoFactor: { select: { secret: true, enabled: true } },
      },
    });
    if (
      !account ||
      account.status !== UserStatus.ACTIVE ||
      account.deletedAt ||
      !account.roles.some((item) => item.role.name === RoleName.ADMIN)
    )
      throw new ForbiddenException('O provisionamento exige uma conta ADMIN ativa.');
    if (account.twoFactor?.enabled)
      throw new ConflictException({
        code: 'TWO_FACTOR_ALREADY_ENABLED',
        message: 'O segundo fator já está ativo. Não será substituído.',
      });
    return account;
  }

  private audit(tx: Prisma.TransactionClient, userId: string, action: string) {
    return tx.auditLog.create({
      data: {
        actorUserId: userId,
        action,
        entityType: 'User',
        entityId: userId,
        metadata: { channel: 'operator' },
      },
    });
  }
}
