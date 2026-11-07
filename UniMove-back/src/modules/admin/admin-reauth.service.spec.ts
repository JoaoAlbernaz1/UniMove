jest.mock('otplib', () => ({
  verify: jest.fn().mockResolvedValue({ valid: true }),
}));

import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { verify } from 'otplib';
import type { PrismaService } from '../../database/prisma.service';
import { UserStatus } from '../../generated/prisma/enums';
import type { AuthAttemptLimiter } from '../auth/auth-attempt-limiter';
import { encryptTwoFactorSecret } from '../auth/two-factor-crypto';
import { AdminReauthService } from './admin-reauth.service';

describe('AdminReauthService', () => {
  const PASSWORD = 'SenhaForte123!';
  let account: {
    passwordHash: string;
    status: UserStatus;
    deletedAt: Date | null;
    twoFactor: { secret: string; enabled: boolean } | null;
  } | null;
  const prisma = {
    user: { findUnique: jest.fn(() => Promise.resolve(account)) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const limiter = {
    assertAllowed: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
    reset: jest.fn().mockResolvedValue(undefined),
    claimCode: jest.fn().mockResolvedValue(true),
  };
  const service = new AdminReauthService(
    prisma as unknown as PrismaService,
    limiter as unknown as AuthAttemptLimiter,
  );
  const credentials = { password: PASSWORD, twoFactorCode: '123456' };

  beforeAll(async () => {
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    account = {
      passwordHash,
      status: UserStatus.ACTIVE,
      deletedAt: null,
      twoFactor: { secret: encryptTwoFactorSecret('REAUTHSECRET'), enabled: true },
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (verify as jest.Mock).mockResolvedValue({ valid: true });
    limiter.claimCode.mockResolvedValue(true);
  });

  it('aceita senha correta com código válido e limpa o contador', async () => {
    await expect(service.assertReauthenticated('admin-id', credentials)).resolves.toBeUndefined();
    expect(limiter.reset).toHaveBeenCalledWith('reauth:admin-id');
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('recusa senha errada, registra falha e audita sem expor o motivo', async () => {
    await expect(
      service.assertReauthenticated('admin-id', { ...credentials, password: 'outra' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(limiter.recordFailure).toHaveBeenCalledWith('reauth:admin-id');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'ADMIN_REAUTH_FAILED' }) }),
    );
  });

  it('recusa código fora do formato de seis dígitos sem chamar o verificador', async () => {
    await expect(
      service.assertReauthenticated('admin-id', { ...credentials, twoFactorCode: 'ABCDEF' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verify).not.toHaveBeenCalled();
  });

  it('código correto já usado tem código de erro próprio e manda esperar o próximo', async () => {
    limiter.claimCode.mockResolvedValue(false);
    // O autenticador mostra o mesmo número por 30 s: quem acabou de entrar
    // encontraria esse caso o tempo todo, e "código inválido" mandaria a pessoa
    // conferir a senha em vez de aguardar.
    await expect(service.assertReauthenticated('admin-id', credentials)).rejects.toMatchObject({
      response: { code: 'ADMIN_REAUTH_CODE_ALREADY_USED' },
    });
    // Reuso não conta como tentativa errada nem polui a auditoria de falha.
    expect(limiter.recordFailure).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('código errado continua devolvendo falha genérica de reautenticação', async () => {
    (verify as jest.Mock).mockResolvedValue({ valid: false });
    await expect(service.assertReauthenticated('admin-id', credentials)).rejects.toMatchObject({
      response: { code: 'ADMIN_REAUTH_FAILED' },
    });
    expect(limiter.recordFailure).toHaveBeenCalledWith('reauth:admin-id');
  });

  it('recusa conta suspensa mesmo com senha e código corretos', async () => {
    const original = account!.status;
    account!.status = UserStatus.SUSPENDED;
    await expect(service.assertReauthenticated('admin-id', credentials)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    account!.status = original;
  });

  it('recusa conta sem segundo fator ativo', async () => {
    const original = account!.twoFactor;
    account!.twoFactor = { ...original!, enabled: false };
    await expect(service.assertReauthenticated('admin-id', credentials)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    account!.twoFactor = original;
  });

  it('paga o custo do argon2 para conta inexistente, sem vazar por tempo', async () => {
    const previous = account;
    account = null;
    await expect(service.assertReauthenticated('fantasma', credentials)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    account = previous;
  });
});
