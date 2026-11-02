import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PrismaService } from '../../database/prisma.service';
import { AcademicVerificationStatus, RoleName } from '../../generated/prisma/enums';
import { REQUIRE_ACADEMIC_VERIFICATION } from '../decorators/profile.decorators';
import { ProfileCompleteGuard } from './profile-complete.guard';

describe('Acesso após completar perfil', () => {
  const findUnique = jest.fn();
  const getAllAndOverride = jest.fn();
  const requestUser = { id: 'user-id', roles: [] as RoleName[] };
  const guard = new ProfileCompleteGuard(
    { getAllAndOverride } as unknown as Reflector,
    { user: { findUnique } } as unknown as PrismaService,
  );
  const context = {
    getHandler: () => () => {},
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user: requestUser }) }),
  } as unknown as ExecutionContext;
  beforeEach(() => {
    jest.clearAllMocks();
    getAllAndOverride.mockReturnValue(false);
    requestUser.roles = [];
  });

  it('bloqueia acesso mesmo com token válido se o perfil está incompleto', async () => {
    findUnique.mockResolvedValue({ profileCompletedAt: null });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('libera após a conclusão persistida', async () => {
    findUnique.mockResolvedValue({ profileCompletedAt: new Date() });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: requestUser.id },
      select: { profileCompletedAt: true },
    });
  });
  it('permite rotas públicas e rotas de preenchimento do perfil', async () => {
    getAllAndOverride.mockReturnValue(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('bloqueia acesso à busca de caronas sem aprovação acadêmica', async () => {
    getAllAndOverride.mockImplementation((key: string) => key === REQUIRE_ACADEMIC_VERIFICATION);
    findUnique.mockResolvedValue({
      profileCompletedAt: new Date(),
      academicVerification: { status: AcademicVerificationStatus.PENDING_REVIEW },
    });
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ACADEMIC_VERIFICATION_REQUIRED' }),
    });
  });

  it('bloqueia acesso quando nenhum comprovante foi enviado', async () => {
    getAllAndOverride.mockImplementation((key: string) => key === REQUIRE_ACADEMIC_VERIFICATION);
    findUnique.mockResolvedValue({
      profileCompletedAt: new Date(),
      academicVerification: null,
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ACADEMIC_VERIFICATION_REQUIRED' }),
    });
  });

  it('libera ações protegidas após a aprovação da validação', async () => {
    getAllAndOverride.mockImplementation((key: string) => key === REQUIRE_ACADEMIC_VERIFICATION);
    findUnique.mockResolvedValue({
      profileCompletedAt: new Date(),
      academicVerification: { status: AcademicVerificationStatus.APPROVED },
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          academicVerification: { select: { status: true } },
        }),
      }),
    );
  });

  it('mantém o acesso administrativo sem exigir validação acadêmica', async () => {
    requestUser.roles = [RoleName.ADMIN];
    getAllAndOverride.mockImplementation((key: string) => key === REQUIRE_ACADEMIC_VERIFICATION);
    findUnique.mockResolvedValue({ profileCompletedAt: new Date(), academicVerification: null });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ select: { profileCompletedAt: true } }),
    );
  });
});
