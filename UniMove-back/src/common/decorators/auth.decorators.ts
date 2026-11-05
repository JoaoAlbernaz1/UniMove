import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { RoleName } from '../../generated/prisma/enums';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthUser {
  id: string;
  /** Lidas do banco a cada requisição: revogar uma role vale de imediato. */
  roles: RoleName[];
  /** Login concluído com segundo fator, e o segundo fator continua ativo. */
  mfa?: boolean;
}
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<{ user: AuthUser }>().user,
);
