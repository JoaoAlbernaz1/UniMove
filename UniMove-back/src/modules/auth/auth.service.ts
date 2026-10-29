import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { RoleName, UserStatus } from '../../generated/prisma/enums';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import {
  PASSWORD_REQUIREMENTS,
  TERMS_VERSION,
  PRIVACY_POLICY_VERSION,
} from './registration-policy';
import { TERMS_OF_USE, PRIVACY_POLICY } from './registration-documents';

@Injectable()
export class AuthService {
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
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.institutionalEmail.trim().toLowerCase();
    const domain = email.split('@')[1];
    if (!this.config.get<string[]>('auth.institutionalDomains')?.includes(domain)) {
      throw new ConflictException('Use um e-mail institucional permitido.');
    }
    const cpf = dto.cpf.replace(/\D/g, '');
    if (!this.isValidCpf(cpf)) throw new ConflictException('CPF inválido.');
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
      return user;
    });
  }

  async login(dto: LoginDto, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { institutionalEmail: dto.email.toLowerCase() },
      include: { roles: { include: { role: true } } },
    });
    if (!user || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Conta indisponível para login.');
    }
    const tokens = await this.issueTokens(
      user.id,
      user.roles.map((item) => item.role.name),
      userAgent,
    );
    await this.prisma.auditLog.create({
      data: { actorUserId: user.id, action: 'LOGIN', entityType: 'User', entityId: user.id },
    });
    return tokens;
  }

  async refresh(rawToken: string, userAgent?: string) {
    let payload: { sub: string; sid: string; familyId: string; type: string };
    try {
      payload = await this.jwt.verifyAsync(rawToken, {
        secret: this.config.getOrThrow('auth.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido.');
    }
    const session = await this.prisma.refreshSession.findUnique({
      where: { id: payload.sid },
      include: { user: { include: { roles: { include: { role: true } } } } },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !(await argon2.verify(session.tokenHash, rawToken))
    ) {
      throw new UnauthorizedException('Refresh token revogado ou expirado.');
    }
    return this.issueTokens(
      session.userId,
      session.user.roles.map((item) => item.role.name),
      userAgent,
      session,
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
  ) {
    const familyId = previous?.familyId ?? randomUUID();
    const sessionId = randomUUID();
    const accessToken = await this.jwt.signAsync(
      { sub: userId, roles, type: 'access' },
      {
        secret: this.config.getOrThrow('auth.accessSecret'),
        expiresIn: this.config.get('auth.accessExpiration'),
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, sid: sessionId, familyId, type: 'refresh' },
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

  private isValidCpf(cpf: string) {
    if (!/^\d{11}$/.test(cpf) || /^(\d)\1+$/.test(cpf)) return false;
    const digit = (length: number) => {
      const sum = cpf
        .slice(0, length)
        .split('')
        .reduce((acc, number, index) => acc + Number(number) * (length + 1 - index), 0);
      const rest = (sum * 10) % 11;
      return rest === 10 ? 0 : rest;
    };
    return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
  }
}
