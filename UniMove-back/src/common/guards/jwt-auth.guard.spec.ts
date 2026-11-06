import {
  ExecutionContext,
  ForbiddenException,
  RequestMethod,
  UnauthorizedException,
} from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { PrismaService } from '../../database/prisma.service';
import { RoleName, UserStatus } from '../../generated/prisma/enums';
import { IS_PUBLIC_KEY } from '../decorators/auth.decorators';
import { ADMIN_APP_ALLOWED, ADMIN_SESSION_ALLOWED } from '../decorators/admin.decorators';
import { adminCookieNames } from '../security/admin-session';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const getAllAndOverride = jest.fn();
  const verifyAsync = jest.fn();
  const getOrThrow = jest.fn().mockReturnValue('secret');
  const findUnique = jest.fn();
  const request: {
    headers: { authorization?: string };
    cookies?: Record<string, string>;
    method: string;
  } = { headers: { authorization: 'Bearer access-token' }, method: 'GET' };
  class Controller {}
  const handler = () => {};
  const context = {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => Controller,
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
    request.headers.authorization = 'Bearer access-token';
    delete request.cookies;
    Reflect.defineMetadata(PATH_METADATA, 'users/me', Controller);
    Reflect.defineMetadata(PATH_METADATA, '', handler);
    Reflect.defineMetadata(METHOD_METADATA, RequestMethod.GET, handler);
    getAllAndOverride.mockReturnValue(false);
    // Token do aplicativo: lista papéis. O do painel não lista, e é exercitado
    // nos casos de rota administrativa mais abaixo.
    verifyAsync.mockResolvedValue({
      sub: 'user-id',
      roles: [RoleName.ADMIN, RoleName.PASSENGER],
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
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'user-id' },
      select: {
        status: true,
        roles: { select: { role: { select: { name: true } } } },
        twoFactor: { select: { enabled: true } },
      },
    });
    expect(request).toHaveProperty('user', {
      id: 'user-id',
      roles: [RoleName.PASSENGER],
      mfa: false,
    });
  });

  it('revoga o papel de motorista mesmo com um token antigo ainda válido', async () => {
    verifyAsync.mockResolvedValue({
      sub: 'user-id',
      roles: [RoleName.DRIVER, RoleName.PASSENGER],
      type: 'access',
    });
    await guard.canActivate(context);
    expect(request).toHaveProperty('user.roles', [RoleName.PASSENGER]);
  });

  it('usa os papéis do banco quando o token não lista nenhum, como o do painel', async () => {
    verifyAsync.mockResolvedValue({ sub: 'user-id', type: 'access' });
    findUnique.mockResolvedValue({
      status: UserStatus.ACTIVE,
      roles: [{ role: { name: RoleName.ADMIN } }, { role: { name: RoleName.PASSENGER } }],
      twoFactor: { enabled: true },
    });
    await guard.canActivate(context);
    expect(request).toHaveProperty('user.roles', [RoleName.ADMIN, RoleName.PASSENGER]);
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

  const adminRoute = (path: string) => {
    getAllAndOverride.mockImplementation(
      (key: string) =>
        key === ADMIN_SESSION_ALLOWED ||
        (key === ADMIN_APP_ALLOWED && Reflect.getMetadata(ADMIN_APP_ALLOWED, handler) === true),
    );
    Reflect.defineMetadata(ADMIN_APP_ALLOWED, path === 'admin/academic-verifications', handler);
    Reflect.defineMetadata(PATH_METADATA, path, Controller);
    verifyAsync.mockResolvedValue({ sub: 'user-id', type: 'access', mfa: true });
    findUnique.mockResolvedValue({
      status: UserStatus.ACTIVE,
      roles: [{ role: { name: RoleName.ADMIN } }],
      twoFactor: { enabled: true },
      refreshSessions: [{ id: 'sid' }],
    });
  };

  it('recusa Bearer do app nas ferramentas do painel mesmo com ADMIN e MFA', async () => {
    adminRoute('admin');
    Reflect.defineMetadata(PATH_METADATA, 'users', handler);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    ['assinatura inválida', { sub: 'user-id', type: 'access', mfa: true }, 'wrong-secret'],
    [
      'token do painel copiado como Bearer',
      { sub: 'user-id', type: 'access', scope: 'admin', sid: 'sid', mfa: true },
      'secret',
    ],
  ])(
    'retorna 401 antes da política Bearer para %s em rota do painel',
    async (_name, payload, secret) => {
      adminRoute('admin');
      const jwt = new JwtService();
      request.headers.authorization = `Bearer ${await jwt.signAsync(payload, { secret })}`;
      const authenticatingGuard = new JwtAuthGuard(
        { getAllAndOverride } as unknown as Reflector,
        jwt,
        { getOrThrow } as unknown as ConfigService,
        { user: { findUnique } } as unknown as PrismaService,
      );
      await expect(authenticatingGuard.canActivate(context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(findUnique).not.toHaveBeenCalled();
    },
  );

  it('preserva Bearer com ADMIN e MFA somente nas rotas acadêmicas já usadas pelo app', async () => {
    adminRoute('admin/academic-verifications');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    Reflect.defineMetadata(PATH_METADATA, ':userId', handler);
    Reflect.defineMetadata(METHOD_METADATA, RequestMethod.PATCH, handler);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    Reflect.defineMetadata(PATH_METADATA, 'new-tool', handler);
    Reflect.defineMetadata(ADMIN_APP_ALLOWED, false, handler);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each(['role', 'mfa'])('recusa Bearer acadêmico após revogar %s no banco', async (revoked) => {
    adminRoute('admin/academic-verifications');
    findUnique.mockResolvedValue({
      status: UserStatus.ACTIVE,
      roles: [{ role: { name: revoked === 'role' ? RoleName.PASSENGER : RoleName.ADMIN } }],
      twoFactor: { enabled: revoked !== 'mfa' },
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('aceita cookie administrativo com sessão ativa nas ferramentas do painel', async () => {
    adminRoute('admin');
    delete request.headers.authorization;
    request.cookies = { [adminCookieNames().access]: 'cookie-token' };
    verifyAsync.mockResolvedValue({
      sub: 'user-id',
      type: 'access',
      mfa: true,
      scope: 'admin',
      sid: 'sid',
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    verifyAsync.mockResolvedValue({ sub: 'user-id', type: 'access', mfa: true, scope: 'admin' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
