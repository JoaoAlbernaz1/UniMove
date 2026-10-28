import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../../database/prisma.service';
import { UserStatus } from '../../generated/prisma/enums';
import { AuthService } from './auth.service';

describe('AuthService registration', () => {
  const userCreate = jest.fn();
  const auditCreate = jest.fn();
  const roleUpsert = jest.fn().mockResolvedValue({ id: 'role-id' });
  const userFindFirst = jest.fn();
  const transaction = jest.fn((callback: (client: unknown) => unknown) =>
    Promise.resolve(
      callback({
        role: { upsert: roleUpsert },
        user: { create: userCreate },
        auditLog: { create: auditCreate },
      }),
    ),
  );
  const prisma = {
    user: { findFirst: userFindFirst },
    $transaction: transaction,
  } as unknown as PrismaService;
  const config = {
    get: jest.fn((key: string) => (key === 'auth.institutionalDomains' ? ['ucb.edu.br'] : null)),
  } as unknown as ConfigService;
  const service = new AuthService(prisma, {} as JwtService, config);
  const dto = {
    fullName: 'Maria Souza',
    cpf: '52998224725',
    institutionalEmail: 'maria@ucb.edu.br',
    password: 'Senha123!',
    passwordConfirmation: 'Senha123!',
    acceptedTerms: true,
    termsVersion: '2026-10-28-v1',
    privacyPolicyVersion: '2026-10-28-v1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    userFindFirst.mockResolvedValue(null);
    userCreate.mockResolvedValue({
      id: 'user-id',
      fullName: dto.fullName,
      institutionalEmail: dto.institutionalEmail,
      status: UserStatus.ACTIVE,
    });
  });

  it('registers without SMTP and creates an ACTIVE user', async () => {
    const user = await service.register(dto);
    expect(user.status).toBe(UserStatus.ACTIVE);
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: UserStatus.ACTIVE,
          termsAcceptedAt: expect.any(Date),
          termsVersion: dto.termsVersion,
          privacyPolicyVersion: dto.privacyPolicyVersion,
        }),
      }),
    );
  });

  it('rejects an email outside the configured institutional domains', async () => {
    await expect(
      service.register({ ...dto, institutionalEmail: 'maria@gmail.com' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(userFindFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['CPF', { cpf: dto.cpf }],
    ['email', { institutionalEmail: dto.institutionalEmail }],
  ])('rejects a duplicated %s', async (_field, existing) => {
    userFindFirst.mockResolvedValue({ id: 'existing-id', ...existing });
    await expect(service.register(dto)).rejects.toBeInstanceOf(ConflictException);
    expect(transaction).not.toHaveBeenCalled();
  });
});
