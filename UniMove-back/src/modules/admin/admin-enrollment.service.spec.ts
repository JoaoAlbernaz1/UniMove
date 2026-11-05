jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'OPERATORSECRET'),
  generateURI: jest.fn(() => 'otpauth://totp/fixture'),
  verify: jest.fn().mockResolvedValue({ valid: true }),
}));

import * as argon2 from 'argon2';
import { verify } from 'otplib';
import type { PrismaService } from '../../database/prisma.service';
import { RoleName, UserStatus } from '../../generated/prisma/enums';
import type { AuthAttemptLimiter } from '../auth/auth-attempt-limiter';
import { decryptTwoFactorSecret, encryptTwoFactorSecret } from '../auth/two-factor-crypto';
import { AdminEnrollmentService } from './admin-enrollment.service';

describe('AdminEnrollmentService operator provisioning', () => {
  let factor: { secret: string; enabled: boolean; recoveryCodes: string[] } | null;
  const account = {
    id: 'admin-id',
    institutionalEmail: 'admin@ucb.edu.br',
    status: UserStatus.ACTIVE,
    deletedAt: null as Date | null,
    roles: [{ role: { name: RoleName.ADMIN as RoleName } }],
  };
  const audits: unknown[] = [];
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: { findUnique: jest.fn(() => Promise.resolve({ ...account, twoFactor: factor })) },
    twoFactorAuth: {
      upsert: jest.fn(({ create, update }) => {
        factor = factor
          ? { ...factor, ...update }
          : { enabled: false, recoveryCodes: [], ...create };
        return Promise.resolve(factor);
      }),
      updateMany: jest.fn(({ where, data }) => {
        if (!factor || factor.enabled || factor.secret !== where.secret)
          return Promise.resolve({ count: 0 });
        factor = { ...factor, ...data };
        return Promise.resolve({ count: 1 });
      }),
    },
    auditLog: {
      create: jest.fn(({ data }) => {
        audits.push(data);
        return Promise.resolve(data);
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => Promise.resolve(fn(tx))),
  };
  const limiter = {
    assertAllowed: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
    reset: jest.fn().mockResolvedValue(undefined),
    claimCode: jest.fn().mockResolvedValue(true),
  };
  const service = new AdminEnrollmentService(
    prisma as unknown as PrismaService,
    limiter as unknown as AuthAttemptLimiter,
  );
  const originalKey = process.env.TWO_FACTOR_ENCRYPTION_KEY;
  afterAll(() => {
    if (originalKey === undefined) delete process.env.TWO_FACTOR_ENCRYPTION_KEY;
    else process.env.TWO_FACTOR_ENCRYPTION_KEY = originalKey;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    factor = null;
    audits.length = 0;
    account.roles = [{ role: { name: RoleName.ADMIN } }];
    account.deletedAt = null;
    process.env.TWO_FACTOR_ENCRYPTION_KEY = 'dedicated-fixture-key-with-at-least-32-characters';
    jest.mocked(verify).mockResolvedValue({ valid: true } as never);
    limiter.claimCode.mockResolvedValue(true);
    tx.twoFactorAuth.updateMany.mockImplementation(({ where, data }) => {
      if (!factor || factor.enabled || factor.secret !== where.secret)
        return Promise.resolve({ count: 0 });
      factor = { ...factor, ...data };
      return Promise.resolve({ count: 1 });
    });
  });

  it('begins a pending encrypted factor without enabling it or putting the secret in audit', async () => {
    const result = await service.begin(' ADMIN@UCB.EDU.BR ');
    expect(result).toMatchObject({ secret: 'OPERATORSECRET', issuer: 'UniCarona Admin' });
    expect(result.qrCode).toMatch(/^data:image\/png;base64,/);
    expect(factor).toMatchObject({ enabled: false, recoveryCodes: [] });
    expect(decryptTwoFactorSecret(factor!.secret)).toEqual({
      secret: 'OPERATORSECRET',
      legacy: false,
    });
    expect(JSON.stringify(audits)).not.toContain('OPERATORSECRET');
    expect(audits).toEqual([expect.objectContaining({ action: 'ADMIN_2FA_ENROLLMENT_STARTED' })]);
  });

  it('confirms an operator code, stores only recovery hashes and audits activation', async () => {
    await service.begin(account.institutionalEmail);
    const result = await service.confirm(account.institutionalEmail, '123456');
    expect(factor?.enabled).toBe(true);
    expect(result.recoveryCodes).toHaveLength(8);
    for (const [index, code] of result.recoveryCodes.entries()) {
      expect(code).toMatch(/^[A-F0-9]{5}-[A-F0-9]{5}$/);
      expect(await argon2.verify(factor!.recoveryCodes[index], code.replace('-', ''))).toBe(true);
    }
    expect(audits).toContainEqual(
      expect.objectContaining({ action: 'ADMIN_2FA_ENROLLED', metadata: { channel: 'operator' } }),
    );
    expect(JSON.stringify(audits)).not.toContain(result.recoveryCodes[0]);
  });

  it.each(['begin', 'confirm'] as const)(
    'never replaces an active factor via %s',
    async (operation) => {
      factor = {
        secret: encryptTwoFactorSecret('EXISTING'),
        enabled: true,
        recoveryCodes: ['existing-hash'],
      };
      const existing = { ...factor };
      await expect(
        operation === 'begin'
          ? service.begin(account.institutionalEmail)
          : service.confirm(account.institutionalEmail, '123456'),
      ).rejects.toMatchObject({ response: { code: 'TWO_FACTOR_ALREADY_ENABLED' } });
      expect(factor).toEqual(existing);
    },
  );

  it.each(['begin', 'confirm'] as const)(
    'requires a dedicated key even outside production for %s',
    async (operation) => {
      delete process.env.TWO_FACTOR_ENCRYPTION_KEY;
      await expect(
        operation === 'begin'
          ? service.begin(account.institutionalEmail)
          : service.confirm(account.institutionalEmail, '123456'),
      ).rejects.toMatchObject({ response: { code: 'TWO_FACTOR_KEY_MISSING' } });
      expect(factor).toBeNull();
    },
  );

  it('rejects a removed ADMIN role and a deleted account', async () => {
    account.roles = [{ role: { name: RoleName.PASSENGER } }];
    await expect(service.begin(account.institutionalEmail)).rejects.toThrow();
    account.roles = [{ role: { name: RoleName.ADMIN } }];
    account.deletedAt = new Date();
    await expect(service.begin(account.institutionalEmail)).rejects.toThrow();
    expect(factor).toBeNull();
  });

  it('does not activate an invalid, replayed or replaced pending factor', async () => {
    await service.begin(account.institutionalEmail);
    jest.mocked(verify).mockResolvedValueOnce({ valid: false } as never);
    await expect(service.confirm(account.institutionalEmail, '123456')).rejects.toThrow();
    limiter.claimCode.mockResolvedValueOnce(false);
    await expect(service.confirm(account.institutionalEmail, '123456')).rejects.toThrow();
    tx.twoFactorAuth.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.confirm(account.institutionalEmail, '123456')).rejects.toThrow();
    expect(factor?.enabled).toBe(false);
    expect(audits).not.toContainEqual(expect.objectContaining({ action: 'ADMIN_2FA_ENROLLED' }));
  });
});
