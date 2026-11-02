import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY, AuthUser } from '../decorators/auth.decorators';
import { RoleName, UserStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../database/prisma.service';

interface AccessPayload {
  sub: string;
  roles: RoleName[];
  type: 'access';
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<Request & { user: AuthUser }>();
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) throw new UnauthorizedException('Token de acesso ausente.');
    let payload: AccessPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessPayload>(token, {
        secret: this.config.getOrThrow('auth.accessSecret'),
      });
    } catch {
      throw new UnauthorizedException('Token de acesso inválido ou expirado.');
    }
    if (payload.type !== 'access')
      throw new UnauthorizedException('Token de acesso inválido ou expirado.');
    const account = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { status: true },
    });
    if (account?.status !== UserStatus.ACTIVE)
      throw new UnauthorizedException('Conta indisponível para acesso.');
    request.user = { id: payload.sub, roles: payload.roles };
    return true;
  }
}
