import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleName } from '../../generated/prisma/enums';
import type { AuthUser } from '../decorators/auth.decorators';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const getAllAndOverride = jest.fn();
  const guard = new RolesGuard({ getAllAndOverride } as unknown as Reflector);
  const contextFor = (user: AuthUser) =>
    ({
      getHandler: () => () => {},
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  beforeEach(() => jest.clearAllMocks());

  it('libera rota sem exigência de role', () => {
    getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(contextFor({ id: 'a', roles: [] }))).toBe(true);
  });

  it('recusa quem não tem a role', () => {
    getAllAndOverride.mockReturnValue([RoleName.ADMIN]);
    expect(() =>
      guard.canActivate(contextFor({ id: 'a', roles: [RoleName.PASSENGER], mfa: true })),
    ).toThrow(ForbiddenException);
  });

  it('recusa administrador sem segundo fator, com código específico', () => {
    getAllAndOverride.mockReturnValue([RoleName.ADMIN]);
    try {
      guard.canActivate(contextFor({ id: 'a', roles: [RoleName.ADMIN], mfa: false }));
      throw new Error('deveria recusar');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: 'ADMIN_2FA_REQUIRED',
      });
    }
  });

  it('libera administrador com segundo fator', () => {
    getAllAndOverride.mockReturnValue([RoleName.ADMIN]);
    expect(guard.canActivate(contextFor({ id: 'a', roles: [RoleName.ADMIN], mfa: true }))).toBe(
      true,
    );
  });

  it('não exige segundo fator em rotas de outras roles', () => {
    getAllAndOverride.mockReturnValue([RoleName.DRIVER]);
    expect(guard.canActivate(contextFor({ id: 'a', roles: [RoleName.DRIVER] }))).toBe(true);
  });
});
