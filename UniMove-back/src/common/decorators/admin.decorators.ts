import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { RoleName } from '../../generated/prisma/enums';
import { NoStoreInterceptor } from '../interceptors/no-store.interceptor';
import { Roles } from './auth.decorators';
import { AllowIncompleteProfile } from './profile.decorators';

export const ADMIN_SESSION_ALLOWED = 'adminSessionAllowed';

/** Só estas rotas aceitam o cookie de sessão do painel; as demais seguem em Bearer. */
export const AllowAdminSession = () => SetMetadata(ADMIN_SESSION_ALLOWED, true);

/**
 * Rota administrativa: exige role ADMIN e segundo fator (RolesGuard), mas não
 * perfil acadêmico de estudante, que administradores não precisam completar.
 */
export const AdminRoute = () =>
  applyDecorators(
    ApiBearerAuth(),
    Roles(RoleName.ADMIN),
    AllowIncompleteProfile(),
    AllowAdminSession(),
    UseInterceptors(NoStoreInterceptor),
  );
