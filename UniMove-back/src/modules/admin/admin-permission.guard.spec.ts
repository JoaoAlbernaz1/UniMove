import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { PrismaService } from '../../database/prisma.service';
import { AdminPermission } from '../../generated/prisma/enums';
import { AdminPermissionsGuard } from './admin-permission.guard';

describe('AdminPermissionsGuard', () => {
  const adminAccess = { findUnique: jest.fn() };
  const prisma = { adminAccess };
  let required: AdminPermission[] | undefined;
  let user: { id: string } | undefined;

  const reflector = {
    getAllAndOverride: jest.fn(() => required),
  };
  const context = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  };
  const guard = new AdminPermissionsGuard(
    reflector as unknown as Reflector,
    prisma as unknown as PrismaService,
  );
  const run = () =>
    guard.canActivate(context as unknown as Parameters<AdminPermissionsGuard['canActivate']>[0]);

  beforeEach(() => {
    jest.clearAllMocks();
    required = [AdminPermission.MANAGE_ADMINS];
    user = { id: 'admin-id' };
  });

  it('libera rota que não declara permissão, sem consultar o banco', async () => {
    required = undefined;
    await expect(run()).resolves.toBe(true);
    expect(adminAccess.findUnique).not.toHaveBeenCalled();
  });

  it('recusa quando a conta não tem linha de permissões', async () => {
    adminAccess.findUnique.mockResolvedValue(null);
    await expect(run()).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('recusa quando a permissão exigida não foi concedida', async () => {
    adminAccess.findUnique.mockResolvedValue({
      permissions: [AdminPermission.VIEW_REPORTS, AdminPermission.VIEW_AUDIT],
    });
    await expect(run()).rejects.toMatchObject({
      response: { code: 'ADMIN_PERMISSION_REQUIRED', required: [AdminPermission.MANAGE_ADMINS] },
    });
  });

  it('exige todas as permissões declaradas, não qualquer uma delas', async () => {
    required = [AdminPermission.MANAGE_ADMINS, AdminPermission.MANAGE_USERS];
    adminAccess.findUnique.mockResolvedValue({ permissions: [AdminPermission.MANAGE_ADMINS] });
    await expect(run()).rejects.toMatchObject({
      response: { required: [AdminPermission.MANAGE_USERS] },
    });
  });

  it('libera quando todas as permissões estão concedidas', async () => {
    adminAccess.findUnique.mockResolvedValue({
      permissions: [AdminPermission.MANAGE_ADMINS, AdminPermission.VIEW_AUDIT],
    });
    await expect(run()).resolves.toBe(true);
  });

  it('lê a permissão do banco a cada requisição: revogar vale na hora', async () => {
    adminAccess.findUnique.mockResolvedValueOnce({
      permissions: [AdminPermission.MANAGE_ADMINS],
    });
    await expect(run()).resolves.toBe(true);
    adminAccess.findUnique.mockResolvedValueOnce({ permissions: [] });
    await expect(run()).rejects.toBeInstanceOf(ForbiddenException);
    expect(adminAccess.findUnique).toHaveBeenCalledTimes(2);
  });

  it('recusa requisição sem usuário na sessão', async () => {
    user = undefined;
    await expect(run()).rejects.toBeInstanceOf(ForbiddenException);
    expect(adminAccess.findUnique).not.toHaveBeenCalled();
  });
});
