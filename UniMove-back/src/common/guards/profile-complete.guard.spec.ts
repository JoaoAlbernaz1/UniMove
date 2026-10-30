import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PrismaService } from '../../database/prisma.service';
import { ProfileCompleteGuard } from './profile-complete.guard';

describe('Acesso após completar perfil', () => {
  const findUnique = jest.fn();
  const getAllAndOverride = jest.fn();
  const guard = new ProfileCompleteGuard(
    { getAllAndOverride } as unknown as Reflector,
    { user: { findUnique } } as unknown as PrismaService,
  );
  const context = {
    getHandler: () => () => {},
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'user-id' } }) }),
  } as unknown as ExecutionContext;
  beforeEach(() => {
    jest.clearAllMocks();
    getAllAndOverride.mockReturnValue(false);
  });

  it('bloqueia acesso mesmo com token válido se o perfil está incompleto', async () => {
    findUnique.mockResolvedValue({ profileCompletedAt: null });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('libera após a conclusão persistida', async () => {
    findUnique.mockResolvedValue({ profileCompletedAt: new Date() });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
  it('permite rotas públicas e rotas de preenchimento do perfil', async () => {
    getAllAndOverride.mockReturnValue(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
