jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'NOVOSEGREDO'),
  generateURI: jest.fn(() => 'otpauth://totp/x'),
  verify: jest.fn(() => Promise.resolve({ valid: true })),
}));

import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import type { PrismaService } from '../../database/prisma.service';
import { RoleName, UserStatus } from '../../generated/prisma/enums';
import { AuthAttemptLimiter } from '../auth/auth-attempt-limiter';
import { encryptTwoFactorSecret } from '../auth/two-factor-crypto';
import { AdminAuthService } from './admin-auth.service';

describe('AdminAuthService: corridas no cadastro de 2FA', () => {
  const password = 'SenhaForte123!';
  const passwordHash = argon2.hash(password, { type: argon2.argon2id });
  const tx = {
    twoFactorAuth: { updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    user: { findUnique: jest.fn() },
    twoFactorAuth: { updateMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const jwt = {
    signAsync: jest.fn().mockResolvedValue('assinado'),
    verifyAsync: jest.fn(),
  };
  const config = { getOrThrow: jest.fn().mockReturnValue('segredo'), get: jest.fn() };
  const service = new AdminAuthService(
    prisma as unknown as PrismaService,
    jwt as unknown as JwtService,
    config as unknown as ConfigService,
    new AuthAttemptLimiter(),
  );
  const account = async (twoFactor: unknown) => ({
    id: 'admin-id',
    fullName: 'Admin',
    institutionalEmail: 'admin@ucb.edu.br',
    passwordHash: await passwordHash,
    status: UserStatus.ACTIVE,
    deletedAt: null,
    roles: [{ role: { name: RoleName.ADMIN } }],
    twoFactor,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TWO_FACTOR_ENCRYPTION_KEY = 'chave-de-teste-com-tamanho-suficiente';
  });

  it('login paralelo não desativa um fator que acabou de ser ativado', async () => {
    prisma.user.findUnique.mockResolvedValue(await account(null));
    prisma.twoFactorAuth.updateMany.mockResolvedValue({ count: 0 });
    prisma.twoFactorAuth.findUnique.mockResolvedValue({ enabled: true });

    await expect(service.login('admin@ucb.edu.br', password)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.twoFactorAuth.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'admin-id', enabled: false } }),
    );
    expect(prisma.twoFactorAuth.create).not.toHaveBeenCalled();
  });

  it('só ativa o segredo conferido: trocado no meio do caminho, nada é ativado', async () => {
    const secret = encryptTwoFactorSecret('SEGREDOCONFERIDO');
    jwt.verifyAsync.mockResolvedValue({
      sub: 'admin-id',
      type: 'admin_challenge',
      stage: 'enroll',
    });
    prisma.user.findUnique.mockResolvedValue(
      await account({ secret, enabled: false, recoveryCodes: [] }),
    );
    tx.twoFactorAuth.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.verifySecondFactor('desafio', '123456')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(tx.twoFactorAuth.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'admin-id', enabled: false, secret },
      }),
    );
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
