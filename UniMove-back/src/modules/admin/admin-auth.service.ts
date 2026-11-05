import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { PrismaService } from '../../database/prisma.service';
import { RoleName, UserStatus } from '../../generated/prisma/enums';
import { AuthAttemptLimiter } from '../auth/auth-attempt-limiter';
import {
  decryptTwoFactorSecret,
  encryptTwoFactorSecret,
  isTwoFactorKeyConfigured,
} from '../auth/two-factor-crypto';

const CHALLENGE_TTL_SECONDS = 5 * 60;
const ACCESS_TTL_SECONDS = 15 * 60;
const RECOVERY_CODE_COUNT = 8;
// Dois pedidos de refresh legítimos (duas abas) podem disputar o mesmo token.
const REFRESH_RACE_GRACE_MS = 30 * 1000;
const INVALID_CREDENTIALS = 'Credenciais inválidas.';
const INVALID_CODE = 'Código de autenticação inválido.';

type ChallengeStage = 'verify' | 'enroll';
interface ChallengePayload {
  sub: string;
  type: 'admin_challenge';
  stage: ChallengeStage;
}
interface AdminRefreshPayload {
  sub: string;
  sid: string;
  familyId: string;
  type: 'admin_refresh';
  authAt: number;
}

const accountSelect = {
  id: true,
  fullName: true,
  institutionalEmail: true,
  passwordHash: true,
  status: true,
  deletedAt: true,
  roles: { select: { role: { select: { name: true } } } },
  twoFactor: { select: { secret: true, enabled: true, recoveryCodes: true } },
} as const;

function isAdmin(account: { roles: { role: { name: string } }[] }) {
  return account.roles.some((item) => item.role.name === RoleName.ADMIN);
}

function normalizeRecoveryCode(code: string) {
  return code.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly limiter: AuthAttemptLimiter,
  ) {}

  async login(emailInput: string, password: string) {
    const email = emailInput.trim().toLowerCase();
    const limitKey = `login:${email}`;
    this.limiter.assertAllowed(limitKey);

    const account = await this.prisma.user.findUnique({
      where: { institutionalEmail: email },
      select: accountSelect,
    });
    // Conta inexistente também paga o custo do argon2, para não vazar por tempo.
    this.dummyHash ??= argon2.hash(randomBytes(32).toString('hex'), { type: argon2.argon2id });
    const passwordMatches = await argon2.verify(
      account?.passwordHash ?? (await this.dummyHash),
      password,
    );
    if (!account || !passwordMatches) {
      this.limiter.recordFailure(limitKey);
      if (account && isAdmin(account)) await this.audit('ADMIN_LOGIN_FAILED', account.id);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (account.status !== UserStatus.ACTIVE || account.deletedAt)
      throw new UnauthorizedException('Conta indisponível para login.');
    if (!isAdmin(account)) {
      await this.audit('ADMIN_ACCESS_DENIED', account.id);
      throw new ForbiddenException({
        code: 'ADMIN_ACCESS_DENIED',
        message: 'Esta conta não tem acesso ao painel administrativo.',
      });
    }
    this.limiter.reset(limitKey);

    if (account.twoFactor?.enabled)
      return {
        step: 'TWO_FACTOR' as const,
        challenge: await this.signChallenge(account.id, 'verify'),
      };

    return {
      step: 'ENROLL' as const,
      challenge: await this.signChallenge(account.id, 'enroll'),
      enrollment: await this.startEnrollment(account.id, account.institutionalEmail),
    };
  }

  async verifySecondFactor(
    challengeToken: string | undefined,
    codeInput: string,
    userAgent?: string,
  ) {
    const challenge = await this.readChallenge(challengeToken);
    const limitKey = `2fa:${challenge.sub}`;
    this.limiter.assertAllowed(limitKey);

    const account = await this.prisma.user.findUnique({
      where: { id: challenge.sub },
      select: accountSelect,
    });
    if (!account || account.status !== UserStatus.ACTIVE || account.deletedAt || !isAdmin(account))
      throw new UnauthorizedException('Sessão de login inválida. Entre novamente.');
    const factor = account.twoFactor;
    // O estágio assinado precisa continuar valendo: quem começou um cadastro não
    // pode concluí-lo depois que a conta já ativou outro autenticador.
    if (!factor || factor.enabled !== (challenge.stage === 'verify'))
      throw new UnauthorizedException('Sessão de login inválida. Entre novamente.');

    const code = codeInput.trim();
    const isTotp = /^\d{6}$/.test(code);
    let recoveryCodesLeft: string[] | undefined;
    let valid = false;
    if (isTotp) {
      const { secret, legacy } = decryptTwoFactorSecret(factor.secret);
      const result = await verify({ token: code, secret, epochTolerance: 30 });
      valid = result.valid && this.limiter.claimCode(account.id, code);
      if (valid && legacy && challenge.stage === 'verify' && isTwoFactorKeyConfigured())
        await this.prisma.twoFactorAuth.update({
          where: { userId: account.id },
          data: { secret: encryptTwoFactorSecret(secret) },
        });
    } else if (challenge.stage === 'verify') {
      recoveryCodesLeft = await this.consumeRecoveryCode(account.id, factor.recoveryCodes, code);
      valid = recoveryCodesLeft !== undefined;
    }
    if (!valid) {
      this.limiter.recordFailure(limitKey);
      await this.audit('ADMIN_2FA_FAILED', account.id);
      throw new UnauthorizedException(INVALID_CODE);
    }
    this.limiter.reset(limitKey);

    const recoveryCodes =
      challenge.stage === 'enroll'
        ? await this.completeEnrollment(account.id, factor.secret)
        : undefined;
    if (recoveryCodesLeft !== undefined)
      await this.audit('ADMIN_RECOVERY_CODE_USED', account.id, {
        remaining: recoveryCodesLeft.length,
      });

    const session = await this.issueSession(account.id, userAgent);
    await this.audit('ADMIN_LOGIN', account.id);
    return {
      user: this.toSessionUser({
        ...account,
        twoFactorEnabled: true,
        recoveryCodesRemaining:
          recoveryCodes?.length ?? recoveryCodesLeft?.length ?? factor.recoveryCodes.length,
      }),
      ...(recoveryCodes ? { recoveryCodes } : {}),
      ...(recoveryCodesLeft !== undefined
        ? { recoveryCodesRemaining: recoveryCodesLeft.length }
        : {}),
      session,
    };
  }

  async refresh(rawToken: string | undefined, userAgent?: string) {
    const payload = await this.readRefreshToken(rawToken);
    const session = await this.prisma.refreshSession.findUnique({ where: { id: payload.sid } });
    if (
      !session ||
      session.userId !== payload.sub ||
      !(await argon2.verify(session.tokenHash, rawToken!))
    )
      throw new UnauthorizedException('Sessão administrativa expirada.');

    if (session.revokedAt) {
      const lostRace =
        session.replacedById && Date.now() - session.revokedAt.getTime() < REFRESH_RACE_GRACE_MS;
      if (!lostRace) {
        // Token já trocado voltando depois da janela: pode ser roubo. Derruba a família.
        await this.prisma.refreshSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.audit('ADMIN_SESSION_REUSE_DETECTED', session.userId);
      }
      throw new UnauthorizedException('Sessão administrativa expirada.');
    }

    const account = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: accountSelect,
    });
    if (
      !account ||
      account.status !== UserStatus.ACTIVE ||
      account.deletedAt ||
      !isAdmin(account) ||
      !account.twoFactor?.enabled
    ) {
      await this.prisma.refreshSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Sessão administrativa encerrada.');
    }
    return this.issueSession(account.id, userAgent, {
      id: session.id,
      familyId: session.familyId,
      authAt: payload.authAt,
    });
  }

  async logout(rawToken: string | undefined) {
    if (!rawToken) return;
    try {
      const payload = await this.jwt.verifyAsync<AdminRefreshPayload>(rawToken, {
        secret: this.config.getOrThrow('auth.refreshSecret'),
        ignoreExpiration: true,
      });
      if (payload.type !== 'admin_refresh') return;
      const { count } = await this.prisma.refreshSession.updateMany({
        where: { familyId: payload.familyId, userId: payload.sub, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count) await this.audit('ADMIN_LOGOUT', payload.sub);
    } catch {
      // Logout é idempotente e não revela se o token era válido.
    }
  }

  async sessionUser(userId: string) {
    const account = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: accountSelect,
    });
    return this.toSessionUser({
      ...account,
      twoFactorEnabled: account.twoFactor?.enabled === true,
      recoveryCodesRemaining: account.twoFactor?.recoveryCodes.length ?? 0,
    });
  }

  private toSessionUser(account: {
    id: string;
    fullName: string;
    institutionalEmail: string;
    roles: { role: { name: string } }[];
    twoFactorEnabled: boolean;
    recoveryCodesRemaining?: number;
  }) {
    return {
      id: account.id,
      fullName: account.fullName,
      email: account.institutionalEmail,
      roles: account.roles.map((item) => item.role.name),
      twoFactorEnabled: account.twoFactorEnabled,
      ...(account.recoveryCodesRemaining === undefined
        ? {}
        : { recoveryCodesRemaining: account.recoveryCodesRemaining }),
    };
  }

  private async startEnrollment(userId: string, email: string) {
    // A chave histórica está no repositório público: segredo novo de admin não usa.
    if (process.env.NODE_ENV === 'production' && !isTwoFactorKeyConfigured()) {
      this.logger.error(
        'TWO_FACTOR_ENCRYPTION_KEY ausente: cadastro de 2FA administrativo recusado.',
      );
      throw new ServiceUnavailableException({
        code: 'TWO_FACTOR_KEY_MISSING',
        message: 'O segundo fator ainda não está configurado neste ambiente.',
      });
    }
    const secret = generateSecret();
    const encrypted = encryptTwoFactorSecret(secret);
    // Condicional: outro login em paralelo não pode desativar um fator recém-ativado.
    const { count } = await this.prisma.twoFactorAuth.updateMany({
      where: { userId, enabled: false },
      data: { secret: encrypted, recoveryCodes: [] },
    });
    if (!count) {
      const existing = await this.prisma.twoFactorAuth.findUnique({
        where: { userId },
        select: { enabled: true },
      });
      if (existing?.enabled)
        throw new ConflictException({
          code: 'TWO_FACTOR_ALREADY_ENABLED',
          message: 'O segundo fator já foi ativado nesta conta. Entre novamente.',
        });
      await this.prisma.twoFactorAuth.create({
        data: { userId, secret: encrypted, enabled: false },
      });
    }
    const uri = generateURI({ secret, label: email, issuer: 'UniCarona Admin' });
    return { secret, qrCode: await QRCode.toDataURL(uri), issuer: 'UniCarona Admin' };
  }

  private async completeEnrollment(userId: string, verifiedSecret: string) {
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const raw = randomBytes(5).toString('hex').toUpperCase();
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
    const hashes = await Promise.all(
      recoveryCodes.map((code) =>
        argon2.hash(normalizeRecoveryCode(code), { type: argon2.argon2id }),
      ),
    );
    await this.prisma.$transaction(async (tx) => {
      // Ativa exatamente o segredo conferido. Se outro login trocou o segredo no meio
      // do caminho, nada é ativado.
      const { count } = await tx.twoFactorAuth.updateMany({
        where: { userId, enabled: false, secret: verifiedSecret },
        data: { enabled: true, recoveryCodes: hashes },
      });
      if (!count) throw new UnauthorizedException('Sessão de login inválida. Entre novamente.');
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'ADMIN_2FA_ENROLLED',
          entityType: 'User',
          entityId: userId,
        },
      });
    });
    return recoveryCodes;
  }

  /** Retorna os códigos restantes, ou undefined se o código não valer. */
  private async consumeRecoveryCode(userId: string, stored: string[], input: string) {
    const code = normalizeRecoveryCode(input);
    if (code.length !== 10) return undefined;
    for (const hash of stored) {
      if (!(await argon2.verify(hash, code))) continue;
      const remaining = stored.filter((item) => item !== hash);
      // Condicional: dois usos simultâneos do mesmo código não passam os dois.
      const { count } = await this.prisma.twoFactorAuth.updateMany({
        where: { userId, recoveryCodes: { equals: stored } },
        data: { recoveryCodes: remaining },
      });
      return count ? remaining : undefined;
    }
    return undefined;
  }

  private async issueSession(
    userId: string,
    userAgent?: string,
    previous?: { id: string; familyId: string; authAt: number },
  ) {
    const now = Math.floor(Date.now() / 1000);
    const authAt = previous?.authAt ?? now;
    const maxHours = this.config.get<number>('admin.sessionMaxHours') ?? 12;
    // A rotação não estende a sessão: passado o limite, é preciso entrar de novo.
    const remaining = authAt + maxHours * 3600 - now;
    if (remaining <= 0) throw new UnauthorizedException('Sessão administrativa expirada.');

    const familyId = previous?.familyId ?? randomUUID();
    const sessionId = randomUUID();
    const accessTtl = Math.min(ACCESS_TTL_SECONDS, remaining);
    const accessToken = await this.jwt.signAsync(
      { sub: userId, type: 'access', scope: 'admin', sid: sessionId, mfa: true },
      { secret: this.config.getOrThrow('auth.accessSecret'), expiresIn: accessTtl },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, sid: sessionId, familyId, type: 'admin_refresh', authAt },
      { secret: this.config.getOrThrow('auth.refreshSecret'), expiresIn: remaining },
    );
    const tokenHash = await argon2.hash(refreshToken);
    await this.prisma.$transaction(async (tx) => {
      if (previous) {
        // Quem marcar primeiro leva: o segundo refresh concorrente não gera outra sessão.
        const { count } = await tx.refreshSession.updateMany({
          where: { id: previous.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        if (!count) throw new UnauthorizedException('Sessão administrativa expirada.');
      }
      await tx.refreshSession.create({
        data: {
          id: sessionId,
          userId,
          familyId,
          tokenHash,
          expiresAt: new Date((now + remaining) * 1000),
          userAgent,
        },
      });
      if (previous)
        await tx.refreshSession.update({
          where: { id: previous.id },
          data: { replacedById: sessionId },
        });
    });
    return {
      accessToken,
      refreshToken,
      csrfToken: randomBytes(32).toString('base64url'),
      accessMaxAgeMs: accessTtl * 1000,
      sessionMaxAgeMs: remaining * 1000,
    };
  }

  private signChallenge(userId: string, stage: ChallengeStage) {
    return this.jwt.signAsync(
      { sub: userId, type: 'admin_challenge', stage },
      { secret: this.config.getOrThrow('auth.accessSecret'), expiresIn: CHALLENGE_TTL_SECONDS },
    );
  }

  private async readChallenge(token: string | undefined) {
    let payload: ChallengePayload | undefined;
    try {
      if (token)
        payload = await this.jwt.verifyAsync<ChallengePayload>(token, {
          secret: this.config.getOrThrow('auth.accessSecret'),
        });
    } catch {
      payload = undefined;
    }
    if (payload?.type !== 'admin_challenge')
      throw new UnauthorizedException('Sessão de login expirada. Entre novamente.');
    return payload;
  }

  private async readRefreshToken(token: string | undefined) {
    let payload: AdminRefreshPayload | undefined;
    try {
      if (token)
        payload = await this.jwt.verifyAsync<AdminRefreshPayload>(token, {
          secret: this.config.getOrThrow('auth.refreshSecret'),
        });
    } catch {
      payload = undefined;
    }
    if (payload?.type !== 'admin_refresh')
      throw new UnauthorizedException('Sessão administrativa expirada.');
    return payload;
  }

  private audit(action: string, userId: string, metadata?: { remaining: number }) {
    return this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        action,
        entityType: 'User',
        entityId: userId,
        ...(metadata ? { metadata } : {}),
      },
    });
  }
}

export const ADMIN_CHALLENGE_MAX_AGE_MS = CHALLENGE_TTL_SECONDS * 1000;
