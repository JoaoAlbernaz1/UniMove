import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import { verify } from 'otplib';
import { PrismaService } from '../../database/prisma.service';
import { isValidCpf } from '../../common/validators/cpf';
import { NotificationType, RoleName, UserStatus } from '../../generated/prisma/enums';
import { NotificationService } from '../notifications/notifications.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import {
  PASSWORD_REQUIREMENTS,
  TERMS_VERSION,
  PRIVACY_POLICY_VERSION,
} from './registration-policy';
import { TERMS_OF_USE, PRIVACY_POLICY } from './registration-documents';
import { AuthAttemptLimiter } from './auth-attempt-limiter';
import { decryptTwoFactorSecret } from './two-factor-crypto';

@Injectable()
export class AuthService {
  private dummyHash?: Promise<string>;

  registrationPolicy() {
    return {
      termsVersion: TERMS_VERSION,
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      passwordRequirements: PASSWORD_REQUIREMENTS,
      termsOfUse: TERMS_OF_USE,
      privacyPolicy: PRIVACY_POLICY,
      institutionalDomains: this.config.get<string[]>('auth.institutionalDomains') ?? [],
    };
  }
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly limiter: AuthAttemptLimiter,
    private readonly notifications?: NotificationService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.institutionalEmail.trim().toLowerCase();
    const domain = email.split('@')[1];
    if (!this.config.get<string[]>('auth.institutionalDomains')?.includes(domain)) {
      throw new ConflictException('Use um e-mail institucional permitido.');
    }
    const cpf = dto.cpf.replace(/\D/g, '');
    if (!isValidCpf(cpf)) throw new ConflictException('CPF inválido.');
    const exists = await this.prisma.user.findFirst({
      where: { OR: [{ cpf }, { institutionalEmail: email }] },
    });
    if (exists) throw new ConflictException('CPF ou e-mail já cadastrado.');

    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.upsert({
        where: { name: RoleName.PASSENGER },
        update: {},
        create: { name: RoleName.PASSENGER },
      });
      const user = await tx.user.create({
        data: {
          fullName: dto.fullName.trim(),
          cpf,
          institutionalEmail: email,
          passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }),
          status: UserStatus.ACTIVE,
          termsAcceptedAt: new Date(),
          termsVersion: dto.termsVersion,
          privacyPolicyVersion: dto.privacyPolicyVersion,
          roles: { create: { roleId: role.id } },
        },
        select: { id: true, fullName: true, institutionalEmail: true, status: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'USER_REGISTERED',
          entityType: 'User',
          entityId: user.id,
        },
      });
      await this.notifications?.create(
        {
          userId: user.id,
          type: NotificationType.SYSTEM,
          title: 'Boas-vindas ao UniMove!',
          message:
            'Complete seu perfil e envie o comprovante de matrícula para começar a pegar e oferecer caronas.',
          resourceType: 'ACCOUNT',
          metadata: { kind: 'WELCOME' },
        },
        tx,
      );
      return user;
    });
  }

  async login(dto: LoginDto, userAgent?: string) {
    const email = dto.email.trim().toLowerCase();
    const passwordLimitKey = `login:${email}`;
    await this.limiter.assertAllowed(passwordLimitKey);
    const user = await this.prisma.user.findUnique({
      where: { institutionalEmail: email },
      include: { roles: { include: { role: true } }, twoFactor: true },
    });
    this.dummyHash ??= argon2.hash(randomBytes(32).toString('hex'), { type: argon2.argon2id });
    const passwordMatches = await argon2.verify(
      user?.passwordHash ?? (await this.dummyHash),
      dto.password,
    );
    if (!user || !passwordMatches) {
      await this.limiter.recordFailure(passwordLimitKey);
      if (user?.roles.some((item) => item.role.name === RoleName.ADMIN))
        await this.prisma.auditLog.create({
          data: {
            actorUserId: user.id,
            action: 'ADMIN_LOGIN_FAILED',
            entityType: 'User',
            entityId: user.id,
          },
        });
      throw new UnauthorizedException('Credenciais inválidas.');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Conta indisponível para login.');
    }
    await this.limiter.reset(passwordLimitKey);
    if (user.roles.some((item) => item.role.name === RoleName.ADMIN) && !user.twoFactor?.enabled)
      throw new ForbiddenException({
        code: 'ADMIN_ENROLLMENT_REQUIRED',
        message:
          'O segundo fator administrativo precisa ser provisionado por um operador autorizado.',
      });
    if (user.twoFactor?.enabled) {
      if (!dto.twoFactorCode) return { twoFactorRequired: true as const };
      // Sem isto, quem tem a senha testa códigos a 100 por minuto, e um Bearer com
      // segundo fator abre as rotas administrativas.
      const limitKey = `2fa:${user.id}`;
      await this.limiter.assertAllowed(limitKey);
      const { secret } = decryptTwoFactorSecret(user.twoFactor.secret);
      const result = await verify({ token: dto.twoFactorCode, secret, epochTolerance: 30 });
      if (!result.valid || !(await this.limiter.claimCode(user.id, dto.twoFactorCode))) {
        await this.limiter.recordFailure(limitKey);
        if (user.roles.some((item) => item.role.name === RoleName.ADMIN))
          await this.prisma.auditLog.create({
            data: {
              actorUserId: user.id,
              action: 'ADMIN_2FA_FAILED',
              entityType: 'User',
              entityId: user.id,
            },
          });
        throw new UnauthorizedException('Código de autenticação inválido.');
      }
      await this.limiter.reset(limitKey);
    }
    const tokens = await this.issueTokens(
      user.id,
      user.roles.map((item) => item.role.name),
      userAgent,
      undefined,
      user.twoFactor?.enabled === true,
    );
    await this.prisma.auditLog.create({
      data: { actorUserId: user.id, action: 'LOGIN', entityType: 'User', entityId: user.id },
    });
    return tokens;
  }

  async refresh(rawToken: string, userAgent?: string) {
    let payload: { sub: string; sid: string; familyId: string; type: string; mfa?: boolean };
    try {
      payload = await this.jwt.verifyAsync(rawToken, {
        secret: this.config.getOrThrow('auth.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido.');
    }
    // O refresh da sessão do painel tem rota própria e não vira token Bearer.
    if (payload.type !== 'refresh') throw new UnauthorizedException('Refresh token inválido.');
    const session = await this.prisma.refreshSession.findUnique({
      where: { id: payload.sid },
      include: { user: { include: { roles: { include: { role: true } }, twoFactor: true } } },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !(await argon2.verify(session.tokenHash, rawToken))
    ) {
      throw new UnauthorizedException('Refresh token revogado ou expirado.');
    }
    if (session.user.status !== UserStatus.ACTIVE)
      throw new UnauthorizedException('Conta indisponível para login.');
    if (
      session.user.roles.some((item) => item.role.name === RoleName.ADMIN) &&
      (!session.user.twoFactor?.enabled || payload.mfa !== true)
    ) {
      await this.prisma.refreshSession.updateMany({
        where: { familyId: session.familyId, userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException({
        code: 'ADMIN_2FA_REQUIRED',
        message: 'Entre novamente com o segundo fator para acessar esta conta administrativa.',
      });
    }
    return this.issueTokens(
      session.userId,
      session.user.roles.map((item) => item.role.name),
      userAgent,
      session,
      payload.mfa === true,
    );
  }

  async logout(rawToken: string) {
    try {
      const payload = await this.jwt.verifyAsync<{ sid: string }>(rawToken, {
        secret: this.config.getOrThrow('auth.refreshSecret'),
        ignoreExpiration: true,
      });
      await this.prisma.refreshSession.updateMany({
        where: { id: payload.sid, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      // Logout is idempotent and does not reveal token validity.
    }
  }

  private async issueTokens(
    userId: string,
    roles: RoleName[],
    userAgent?: string,
    previous?: { id: string; familyId: string },
    mfa = false,
  ) {
    const familyId = previous?.familyId ?? randomUUID();
    const sessionId = randomUUID();
    const accessToken = await this.jwt.signAsync(
      { sub: userId, roles, type: 'access', mfa },
      {
        secret: this.config.getOrThrow('auth.accessSecret'),
        expiresIn: this.config.get('auth.accessExpiration'),
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, sid: sessionId, familyId, type: 'refresh', mfa },
      {
        secret: this.config.getOrThrow('auth.refreshSecret'),
        expiresIn: this.config.get('auth.refreshExpiration'),
      },
    );
    const decoded = this.jwt.decode(refreshToken);
    await this.prisma.$transaction(async (tx) => {
      await tx.refreshSession.create({
        data: {
          id: sessionId,
          userId,
          familyId,
          tokenHash: await argon2.hash(refreshToken),
          expiresAt: new Date(decoded.exp * 1000),
          userAgent,
        },
      });
      if (previous) {
        await tx.refreshSession.update({
          where: { id: previous.id },
          data: { revokedAt: new Date(), replacedById: sessionId },
        });
      }
    });
    return { accessToken, refreshToken, expiresIn: 900 };
  }
}
