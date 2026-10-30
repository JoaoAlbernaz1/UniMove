import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, type AuthUser } from '../decorators/auth.decorators';
import { ALLOW_INCOMPLETE_PROFILE } from '../decorators/profile.decorators';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ProfileCompleteGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ||
      this.reflector.getAllAndOverride<boolean>(ALLOW_INCOMPLETE_PROFILE, targets)
    )
      return true;
    const { user } = context.switchToHttp().getRequest<{ user: AuthUser }>();
    const profile = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { profileCompletedAt: true },
    });
    if (!profile?.profileCompletedAt)
      throw new ForbiddenException({
        code: 'PROFILE_INCOMPLETE',
        message:
          'Complete seu perfil com curso, período, Sobre e pelo menos 3 tags para continuar.',
      });
    return true;
  }
}
