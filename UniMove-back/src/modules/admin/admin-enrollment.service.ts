import {
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { RoleName, UserStatus } from '../../generated/prisma/enums';
import { AuthAttemptLimiter } from '../auth/auth-attempt-limiter';
import {
  decryptTwoFactorSecret,
  encryptTwoFactorSecret,
  isTwoFactorKeyConfigured,
} from '../auth/two-factor-crypto';

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
    const secret = generateSecret();
    const encrypted = encryptTwoFactorSecret(secret);
    await this.prisma.$transaction(async (tx) => {
      const account = await this.lockAccount(tx, email);
      await tx.twoFactorAuth.upsert({
        where: { userId: account.id },
        create: { userId: account.id, secret: encrypted, enabled: false },
        update: { secret: encrypted, recoveryCodes: [] },
      });
      await this.audit(tx, account.id, 'ADMIN_2FA_ENROLLMENT_STARTED');
    });
    const uri = generateURI({ secret, label: email, issuer: 'UniCarona Admin' });
    return { secret, qrCode: await QRCode.toDataURL(uri), issuer: 'UniCarona Admin' };
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
      const valid =
        /^\d{6}$/.test(code) && (await verify({ token: code, secret, epochTolerance: 30 })).valid;
      if (!valid || !(await this.limiter.claimCode(account.id, code))) {
        await this.limiter.recordFailure(limitKey);
        throw new UnauthorizedException('Código de autenticação inválido.');
      }
      const recoveryCodes = Array.from({ length: 8 }, () => {
        const raw = randomBytes(5).toString('hex').toUpperCase();
        return `${raw.slice(0, 5)}-${raw.slice(5)}`;
      });
      const hashes = await Promise.all(
        recoveryCodes.map((value) =>
          argon2.hash(value.replace('-', ''), { type: argon2.argon2id }),
        ),
      );
      const { count } = await tx.twoFactorAuth.updateMany({
        where: { userId: account.id, enabled: false, secret: factor.secret },
        data: { enabled: true, secret: encryptTwoFactorSecret(secret), recoveryCodes: hashes },
      });
      if (!count) throw new ConflictException('O provisionamento mudou. Inicie novamente.');
      await this.audit(tx, account.id, 'ADMIN_2FA_ENROLLED');
      await this.limiter.reset(limitKey);
      return { recoveryCodes };
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
