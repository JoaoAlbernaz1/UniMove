import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { PrismaService } from '../../database/prisma.service';
import { RoleName, UserStatus } from '../../generated/prisma/enums';
import { IS_PUBLIC_KEY } from '../decorators/auth.decorators';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const getAllAndOverride = jest.fn();
  const verifyAsync = jest.fn();
  const getOrThrow = jest.fn().mockReturnValue('secret');
  const findUnique = jest.fn();
  const request = { headers: { authorization: 'Bearer access-token' } };
  const context = {
    getType: () => 'http',
    getHandler: () => () => {},
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const guard = new JwtAuthGuard(
    { getAllAndOverride } as unknown as Reflector,
    { verifyAsync } as unknown as JwtService,
    { getOrThrow } as unknown as ConfigService,
    { user: { findUnique } } as unknown as PrismaService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    getAllAndOverride.mockReturnValue(false);
    verifyAsync.mockResolvedValue({
      sub: 'user-id',
      roles: [RoleName.ADMIN],
      type: 'access',
    });
    findUnique.mockResolvedValue({
      status: UserStatus.ACTIVE,
      roles: [{ role: { name: RoleName.PASSENGER } }],
      twoFactor: null,
    });
  });

  it('confirma que a conta continua ativa antes de aceitar o token', async () => {
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request).toHaveProperty('user', {
      id: 'user-id',
      roles: [RoleName.PASSENGER],
      mfa: false,
    });
  });

  it('autoriza pelas roles do banco, não pelas gravadas no token', async () => {
    await guard.canActivate(context);
    expect(request).toHaveProperty('user.roles', [RoleName.PASSENGER]);
  });

  it('só reconhece o segundo fator se o token e a conta confirmarem', async () => {
    verifyAsync.mockResolvedValue({ sub: 'user-id', type: 'access', mfa: true });
    await guard.canActivate(context);
    expect(request).toHaveProperty('user.mfa', false);

    findUnique.mockResolvedValue({
      status: UserStatus.ACTIVE,
      roles: [{ role: { name: RoleName.ADMIN } }],
      twoFactor: { enabled: true },
    });
    await guard.canActivate(context);
    expect(request).toHaveProperty('user.mfa', true);
  });

  it('recusa token da sessão do painel enviado como Bearer', async () => {
    verifyAsync.mockResolvedValue({ sub: 'user-id', type: 'access', scope: 'admin', sid: 'sid' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('invalida imediatamente tokens de contas desativadas', async () => {
    findUnique.mockResolvedValue({ status: UserStatus.DEACTIVATED });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('não consulta conta em rotas públicas', async () => {
    getAllAndOverride.mockImplementation((key: string) => key === IS_PUBLIC_KEY);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
    expect(verifyAsync).not.toHaveBeenCalled();
  });
});
