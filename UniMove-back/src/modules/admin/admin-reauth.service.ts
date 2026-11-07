import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { verify } from 'otplib';
import { PrismaService } from '../../database/prisma.service';
import { UserStatus } from '../../generated/prisma/enums';
import { AuthAttemptLimiter } from '../auth/auth-attempt-limiter';
import { decryptTwoFactorSecret } from '../auth/two-factor-crypto';

export interface ReauthCredentials {
  password: string;
  twoFactorCode: string;
}

/**
 * Reautenticação (step-up) exigida nas operações que mudam quem tem acesso.
 * Sem estado: a senha e um código do autenticador vêm no próprio pedido e são
 * conferidos aqui. O código é consumido por claimCode, então não serve duas
 * vezes — nem na própria operação, nem num replay do corpo da requisição.
 */
@Injectable()
export class AdminReauthService {
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly limiter: AuthAttemptLimiter,
  ) {}

  async assertReauthenticated(userId: string, credentials: ReauthCredentials) {
    const limitKey = `reauth:${userId}`;
    await this.limiter.assertAllowed(limitKey);
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        passwordHash: true,
        status: true,
        deletedAt: true,
        twoFactor: { select: { secret: true, enabled: true } },
      },
    });
    this.dummyHash ??= argon2.hash(randomBytes(32).toString('hex'), { type: argon2.argon2id });
    const passwordMatches = await argon2.verify(
      account?.passwordHash ?? (await this.dummyHash),
      credentials.password,
    );
    const factor = account?.twoFactor;
    const code = credentials.twoFactorCode.trim();
    let valid =
      Boolean(account) &&
      account!.status === UserStatus.ACTIVE &&
      !account!.deletedAt &&
      passwordMatches &&
      factor?.enabled === true &&
      /^\d{6}$/.test(code);
    // Código correto já consumido é um caso próprio: quem acabou de entrar vê o
    // mesmo número no autenticador, e "código inválido" mandaria a pessoa
    // conferir a senha em vez de esperar o próximo código.
    let alreadyUsed = false;
    if (valid && factor) {
      const { secret } = decryptTwoFactorSecret(factor.secret);
      const result = await verify({ token: code, secret, epochTolerance: 30 });
      if (!result.valid) valid = false;
      else {
        alreadyUsed = !(await this.limiter.claimCode(userId, code));
        valid = !alreadyUsed;
      }
    }
    if (alreadyUsed)
      throw new UnauthorizedException({
        code: 'ADMIN_REAUTH_CODE_ALREADY_USED',
        message: 'Este código já foi usado. Aguarde o próximo código do autenticador.',
      });
    if (!valid) {
      await this.limiter.recordFailure(limitKey);
      await this.prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'ADMIN_REAUTH_FAILED',
          entityType: 'User',
          entityId: userId,
        },
      });
      throw new UnauthorizedException({
        code: 'ADMIN_REAUTH_FAILED',
        message: 'Confirme sua senha e um código atual do autenticador para continuar.',
      });
    }
    await this.limiter.reset(limitKey);
  }
}
