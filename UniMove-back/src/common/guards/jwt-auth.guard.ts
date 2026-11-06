import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY, AuthUser } from '../decorators/auth.decorators';
import { ADMIN_APP_ALLOWED, ADMIN_SESSION_ALLOWED } from '../decorators/admin.decorators';
import {
  adminCookieNames,
  assertAdminCsrf,
  assertAdminOrigin,
  isUnsafeMethod,
} from '../security/admin-session';
import { RoleName, UserStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../database/prisma.service';

interface AccessPayload {
  sub: string;
  type: 'access';
  // O token do aplicativo lista os papéis; o do painel não, porque a sessão
  // administrativa confere ADMIN, MFA e sessão viva no banco a cada requisição.
  roles?: RoleName[];
  mfa?: boolean;
  scope?: 'admin';
  sid?: string;
}

const REJECTED = 'Token de acesso inválido ou expirado.';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (context.getType() === 'ws') {
      const client = context.switchToWs().getClient<{ data?: { userId?: string } }>();
      if (typeof client.data?.userId !== 'string')
        throw new UnauthorizedException('Token de acesso ausente.');
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user: AuthUser }>();
    const adminRoute = this.reflector.getAllAndOverride<boolean>(ADMIN_SESSION_ALLOWED, targets);
    const [type, bearer] = request.headers.authorization?.split(' ') ?? [];
    const bearerToken = type === 'Bearer' ? bearer : undefined;
    const cookieToken =
      !bearerToken && adminRoute
        ? (request.cookies as Record<string, string> | undefined)?.[adminCookieNames().access]
        : undefined;
    const token = bearerToken ?? cookieToken;
    if (!token) throw new UnauthorizedException('Token de acesso ausente.');
    let payload: AccessPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessPayload>(token, {
        secret: this.config.getOrThrow('auth.accessSecret'),
      });
    } catch {
      throw new UnauthorizedException(REJECTED);
    }
    // Token de sessão do painel só circula em cookie, e o cookie só carrega esse token.
    const adminSession = payload.scope === 'admin';
    if (
      payload.type !== 'access' ||
      adminSession !== Boolean(cookieToken) ||
      (adminSession && !payload.sid)
    )
      throw new UnauthorizedException(REJECTED);

    if (
      bearerToken &&
      adminRoute &&
      !this.reflector.getAllAndOverride<boolean>(ADMIN_APP_ALLOWED, targets)
    )
      throw new ForbiddenException({
        code: 'ADMIN_COOKIE_SESSION_REQUIRED',
        message: 'Esta ferramenta exige uma sessão do painel administrativo.',
      });

    if (cookieToken && isUnsafeMethod(request.method)) {
      assertAdminOrigin(request, this.config.get<string[]>('admin.origins'));
      assertAdminCsrf(request);
    }

    // Conta, roles e segundo fator vêm do banco: o que o token diz vale só para
    // identificar o usuário, nunca para autorizar.
    const account = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        status: true,
        roles: { select: { role: { select: { name: true } } } },
        twoFactor: { select: { enabled: true } },
        ...(adminSession
          ? {
              refreshSessions: {
                where: { id: payload.sid, revokedAt: null, expiresAt: { gt: new Date() } },
                select: { id: true },
                take: 1,
              },
            }
          : {}),
      },
    });
    if (account?.status !== UserStatus.ACTIVE)
      throw new UnauthorizedException('Conta indisponível para acesso.');
    if (adminSession && !account.refreshSessions?.length)
      throw new UnauthorizedException('Sessão administrativa encerrada.');
    if (
      adminRoute &&
      (!account.roles.some((item) => item.role.name === RoleName.ADMIN) ||
        payload.mfa !== true ||
        account.twoFactor?.enabled !== true)
    )
      throw new ForbiddenException({
        code: 'ADMIN_2FA_REQUIRED',
        message: 'O acesso administrativo exige perfil ADMIN atual e segundo fator confirmado.',
      });

    // A revoked role must stop working even if an old access token has not expired.
    // O token do aplicativo lista os papéis, e aí vale a interseção com o banco:
    // papel revogado cai na hora e um token antigo não ganha papel novo sem
    // relogar. O token do painel não lista papéis — a sessão dele já exige ADMIN
    // atual, MFA e sessão viva, conferidos logo acima — então valem os do banco.
    const currentRoles = account.roles.map((item) => item.role.name);
    request.user = {
      id: payload.sub,
      roles: Array.isArray(payload.roles)
        ? currentRoles.filter((name) => payload.roles!.includes(name))
        : currentRoles,
      mfa: payload.mfa === true && account.twoFactor?.enabled === true,
    };
    return true;
  }
}
