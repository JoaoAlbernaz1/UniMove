jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'NOVOSEGREDO'),
  generateURI: jest.fn(() => 'otpauth://totp/x'),
  verify: jest.fn(() => Promise.resolve({ valid: true })),
}));

import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import type { PrismaService } from '../../database/prisma.service';
import { RoleName, UserStatus } from '../../generated/prisma/enums';
import { AuthAttemptLimiter } from '../auth/auth-attempt-limiter';
import { encryptTwoFactorSecret } from '../auth/two-factor-crypto';
import { AdminAuthService } from './admin-auth.service';

describe('AdminAuthService: provisionamento confiável de 2FA', () => {
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
    {
      assertAllowed: jest.fn(),
      recordFailure: jest.fn(),
      reset: jest.fn(),
      claimCode: jest.fn().mockResolvedValue(true),
    } as unknown as AuthAttemptLimiter,
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

  it('senha correta sem segundo fator exige provisionamento sem emitir segredo ou challenge', async () => {
    prisma.user.findUnique.mockResolvedValue(await account(null));
    prisma.twoFactorAuth.updateMany.mockResolvedValue({ count: 0 });
    prisma.twoFactorAuth.findUnique.mockResolvedValue({ enabled: true });

    await expect(service.login('admin@ucb.edu.br', password)).rejects.toMatchObject({
      response: { code: 'ADMIN_ENROLLMENT_REQUIRED' },
    });
    expect(prisma.twoFactorAuth.updateMany).not.toHaveBeenCalled();
    expect(prisma.twoFactorAuth.create).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('recusa um challenge antigo de enrollment sem consultar ou alterar o fator', async () => {
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
    expect(tx.twoFactorAuth.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('preserva o challenge de verificação para administrador já provisionado', async () => {
    prisma.user.findUnique.mockResolvedValue(await account({ enabled: true }));
    await expect(service.login('admin@ucb.edu.br', password)).resolves.toEqual({
      step: 'TWO_FACTOR',
      challenge: 'assinado',
    });
  });
});

describe('AdminAuthService refresh respects stored session expiry', () => {
  const jwt = new JwtService();
  const config = new ConfigService({
    auth: { accessSecret: 'synthetic-access-secret', refreshSecret: 'synthetic-refresh-secret' },
  });
  const refreshSession = {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const prisma = {
    refreshSession,
    user: { findUnique: jest.fn() },
    $transaction: (run: (tx: { refreshSession: typeof refreshSession }) => unknown) =>
      Promise.resolve(run({ refreshSession })),
  };
  const service = new AdminAuthService(
    prisma as unknown as PrismaService,
    jwt,
    config,
    {} as AuthAttemptLimiter,
  );
  let rawToken: string;
  let session: {
    id: string;
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
    revokedAt: null;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    rawToken = await jwt.signAsync(
      {
        sub: 'admin-id',
        sid: 'session-id',
        familyId: 'family-id',
        type: 'admin_refresh',
        authAt: Math.floor(Date.now() / 1000),
      },
      { secret: 'synthetic-refresh-secret', expiresIn: 3600 },
    );
    session = {
      id: 'session-id',
      userId: 'admin-id',
      familyId: 'family-id',
      tokenHash: await argon2.hash(rawToken),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    };
    refreshSession.findUnique.mockImplementation(() => Promise.resolve(session));
    refreshSession.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-id',
      status: UserStatus.ACTIVE,
      deletedAt: null,
      roles: [{ role: { name: RoleName.ADMIN } }],
      twoFactor: { enabled: true },
    });
  });

  it.each([-1, 0])(
    'does not rotate a JWT still valid for an hour when DB expiry was shortened to now%p ms',
    async (offset) => {
      session.expiresAt = new Date(Date.now() + offset);
      await expect(
        jwt.verifyAsync(rawToken, { secret: 'synthetic-refresh-secret' }),
      ).resolves.toMatchObject({ type: 'admin_refresh' });
      await expect(service.refresh(rawToken)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(refreshSession.create).not.toHaveBeenCalled();
    },
  );

  it('preserves rotation when both JWT and stored session are still valid', async () => {
    await expect(service.refresh(rawToken)).resolves.toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
    expect(refreshSession.create).toHaveBeenCalledTimes(1);
  });
});
