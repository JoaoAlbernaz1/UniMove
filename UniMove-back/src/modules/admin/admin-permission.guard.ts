import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRoute } from '../../common/decorators/admin.decorators';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { PrismaService } from '../../database/prisma.service';
import { AdminPermission } from '../../generated/prisma/enums';

export const ADMIN_PERMISSIONS_KEY = 'adminPermissions';

/**
 * Rota administrativa que exige permissão explícita, além de ADMIN e segundo
 * fator (já cobertos por AdminRoute). A permissão é lida do banco a cada
 * requisição: revogar vale na hora, sem esperar o token expirar.
 */
export const AdminPermissionRoute = (...permissions: AdminPermission[]) =>
  applyDecorators(
    AdminRoute(),
    SetMetadata(ADMIN_PERMISSIONS_KEY, permissions),
    UseGuards(AdminPermissionsGuard),
  );

@Injectable()
export class AdminPermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<AdminPermission[]>(ADMIN_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user?.id) throw new ForbiddenException('Sessão administrativa ausente.');
    const access = await this.prisma.adminAccess.findUnique({
      where: { userId: user.id },
      select: { permissions: true },
    });
    const granted = access?.permissions ?? [];
    // Exige todas as permissões declaradas, não qualquer uma delas.
    const missing = required.filter((permission) => !granted.includes(permission));
    if (missing.length)
      throw new ForbiddenException({
        code: 'ADMIN_PERMISSION_REQUIRED',
        message: 'Sua conta administrativa não tem permissão para esta operação.',
        required: missing,
      });
    return true;
  }
}
