import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, AuthUser } from '../decorators/auth.decorators';
import { RoleName } from '../../generated/prisma/enums';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<RoleName[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;
    const user = context.switchToHttp().getRequest<{ user: AuthUser }>().user;
    const granted = roles.filter((role) => user.roles.includes(role));
    if (!granted.length) throw new ForbiddenException('Perfil sem permissão para esta operação.');
    // Vale para qualquer cliente, painel ou app: senha sozinha não abre rota administrativa.
    if (granted.every((role) => role === RoleName.ADMIN) && !user.mfa)
      throw new ForbiddenException({
        code: 'ADMIN_2FA_REQUIRED',
        message:
          'Ative o segundo fator e entre novamente para usar as ferramentas administrativas.',
      });
    return true;
  }
}
