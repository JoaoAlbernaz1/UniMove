// Registration tests do not exercise TOTP; mock the ESM-only package for Jest's CJS runner.
jest.mock('otplib', () => ({ verify: jest.fn() }));

import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { verify } from 'otplib';
import { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../../database/prisma.service';
import { RoleName, UserStatus } from '../../generated/prisma/enums';
import { AuthAttemptLimiter } from './auth-attempt-limiter';
import { AuthService } from './auth.service';
import { encryptTwoFactorSecret } from './two-factor-crypto';
import { AdminAuthService } from '../admin/admin-auth.service';

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
  const service = new AuthService(prisma, {} as JwtService, config, {} as AuthAttemptLimiter);
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

describe('AuthService admin app authentication', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    twoFactorAuth: { updateMany: jest.fn() },
    refreshSession: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const jwt = {
    signAsync: jest.fn().mockResolvedValue('token'),
    decode: jest.fn().mockReturnValue({ exp: 1999999999 }),
  };
  const limiter = {
    assertAllowed: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
    reset: jest.fn().mockResolvedValue(undefined),
    claimCode: jest.fn().mockResolvedValue(true),
  };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    jwt as unknown as JwtService,
    {
      get: jest.fn(),
      getOrThrow: jest.fn().mockReturnValue('fixture-key'),
    } as unknown as ConfigService,
    limiter as unknown as AuthAttemptLimiter,
  );
  const dto = { email: 'admin@ucb.edu.br', password: 'Password1!', twoFactorCode: '123456' };
  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.TWO_FACTOR_ENCRYPTION_KEY = 'dedicated-fixture-key-with-at-least-32-characters';
    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-id',
      status: UserStatus.ACTIVE,
      passwordHash: await argon2.hash(dto.password),
      roles: [{ role: { name: RoleName.ADMIN } }],
      twoFactor: null,
    });
    prisma.$transaction.mockImplementation((fn: (client: typeof prisma) => unknown) =>
      Promise.resolve(fn(prisma)),
    );
    limiter.claimCode.mockResolvedValue(true);
    limiter.assertAllowed.mockResolvedValue(undefined);
    jest.mocked(verify).mockResolvedValue({ valid: true } as never);
  });

  it('does not issue app tokens for a password-only ADMIN', async () => {
    await expect(service.login(dto)).rejects.toMatchObject({
      response: { code: 'ADMIN_ENROLLMENT_REQUIRED' },
    });
    expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(prisma.refreshSession.create).not.toHaveBeenCalled();
  });

  const enableFactor = async () => {
    const account = await prisma.user.findUnique();
    prisma.user.findUnique.mockResolvedValue({
      ...account,
      twoFactor: { secret: encryptTwoFactorSecret('SECRET'), enabled: true },
    });
  };

  it('awaits replay protection and does not issue tokens for a consumed code', async () => {
    await enableFactor();
    limiter.claimCode.mockResolvedValue(false);
    await expect(service.login(dto)).rejects.toThrow();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('awaits a persisted lock before checking the code', async () => {
    await enableFactor();
    limiter.assertAllowed.mockRejectedValueOnce(new ConflictException('locked'));
    await expect(service.login(dto)).rejects.toThrow('locked');
    expect(verify).not.toHaveBeenCalled();
  });

  it('preserves enrolled ADMIN MFA app login', async () => {
    await enableFactor();
    await expect(service.login(dto)).resolves.toMatchObject({
      accessToken: 'token',
      refreshToken: 'token',
    });
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'access', mfa: true }),
      expect.anything(),
    );
  });

  it('preserves password-only student login', async () => {
    const account = await prisma.user.findUnique();
    prisma.user.findUnique.mockResolvedValue({
      ...account,
      roles: [{ role: { name: RoleName.PASSENGER } }],
    });
    await expect(service.login(dto)).resolves.toMatchObject({ accessToken: 'token' });
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'access', mfa: false }),
      expect.anything(),
    );
  });
});

describe('AuthService shared password attempt protection', () => {
  const config = new ConfigService({
    auth: {
      accessSecret: 'shared-synthetic-server-secret',
      refreshSecret: 'shared-synthetic-refresh-secret',
    },
  });
  const passwordHash = argon2.hash('CorrectPassword1!');
  const jwt = {
    signAsync: jest.fn().mockResolvedValue('token'),
    decode: jest.fn().mockReturnValue({ exp: 1999999999 }),
  };

  const storage = async (admin = true) => {
    const rows: any[] = [];
    const auditLog = {
      findFirst: ({ where }: any) =>
        Promise.resolve(
          rows.find(
            (row) => row.entityType === where.entityType && row.entityId === where.entityId,
          ) ?? null,
        ),
      create: ({ data }: any) => {
        const row = { id: String(rows.length + 1), ...data };
        rows.push(row);
        return Promise.resolve(row);
      },
      update: ({ where, data }: any) => {
        const row = rows.find((item) => item.id === where.id);
        Object.assign(row, data);
        return Promise.resolve(row);
      },
    };
    const tx = {
      auditLog,
      $executeRaw: jest.fn().mockResolvedValue(1),
      refreshSession: { create: jest.fn().mockResolvedValue(undefined) },
    };
    const account = {
      id: 'synthetic-user',
      status: UserStatus.ACTIVE,
      deletedAt: null,
      fullName: 'Synthetic',
      institutionalEmail: 'admin@ucb.edu.br',
      passwordHash: await passwordHash,
      roles: [{ role: { name: admin ? RoleName.ADMIN : RoleName.PASSENGER } }],
      twoFactor: null,
    };
    const prisma = {
      ...tx,
      user: { findUnique: jest.fn().mockResolvedValue(account) },
      $transaction: (run: (client: typeof tx) => unknown) => Promise.resolve(run(tx)),
    } as unknown as PrismaService;
    return { prisma, rows };
  };
  const app = (prisma: PrismaService) =>
    new AuthService(
      prisma,
      jwt as unknown as JwtService,
      config,
      new AuthAttemptLimiter(prisma, config),
    );
  const badLogin = { email: ' ADMIN@UCB.EDU.BR ', password: 'wrong-password' };

  it('persists eight app failures and blocks both a recreated app service and panel on the same normalized key', async () => {
    const { prisma, rows } = await storage();
    const service = app(prisma);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await expect(service.login(badLogin)).rejects.toBeInstanceOf(UnauthorizedException);
    }
    expect(rows.filter((row) => row.action === 'ADMIN_LOGIN_FAILED')).toHaveLength(8);
    expect(rows.find((row) => row.entityType === 'AuthAttemptLimit')?.metadata.failureCount).toBe(
      8,
    );
    await expect(
      app(prisma).login({ ...badLogin, password: 'CorrectPassword1!' }),
    ).rejects.toMatchObject({ response: { code: 'ADMIN_LOGIN_LOCKED' } });
    const panel = new AdminAuthService(
      prisma,
      jwt as unknown as JwtService,
      config,
      new AuthAttemptLimiter(prisma, config),
    );
    await expect(panel.login('admin@ucb.edu.br', 'CorrectPassword1!')).rejects.toMatchObject({
      response: { code: 'ADMIN_LOGIN_LOCKED' },
    });
  });

  it('respects an existing panel lock even for a correct app password', async () => {
    const { prisma } = await storage();
    const panelLimiter = new AuthAttemptLimiter(prisma, config);
    for (let attempt = 0; attempt < 8; attempt += 1)
      await panelLimiter.recordFailure('login:admin@ucb.edu.br');
    await expect(
      app(prisma).login({ ...badLogin, password: 'CorrectPassword1!' }),
    ).rejects.toMatchObject({ response: { code: 'ADMIN_LOGIN_LOCKED' } });
  });

  it('resets earlier password failures after a successful student login', async () => {
    const { prisma, rows } = await storage(false);
    const limiter = new AuthAttemptLimiter(prisma, config);
    for (let attempt = 0; attempt < 7; attempt += 1)
      await limiter.recordFailure('login:admin@ucb.edu.br');
    const service = app(prisma);
    await expect(
      service.login({ email: 'ADMIN@UCB.EDU.BR', password: 'CorrectPassword1!' }),
    ).resolves.toMatchObject({ accessToken: 'token' });
    await expect(service.login(badLogin)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(rows.find((row) => row.entityType === 'AuthAttemptLimit')?.metadata.failureCount).toBe(
      1,
    );
  });

  it('applies the same failure window to nonexistent accounts without creating an admin failure audit', async () => {
    const { prisma, rows } = await storage();
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);
    const service = app(prisma);
    for (let attempt = 0; attempt < 8; attempt += 1)
      await expect(service.login(badLogin)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(app(prisma).login(badLogin)).rejects.toMatchObject({
      response: { code: 'ADMIN_LOGIN_LOCKED' },
    });
    expect(rows.filter((row) => row.action === 'ADMIN_LOGIN_FAILED')).toHaveLength(0);
  });
});

describe('AuthService refresh revalidates administrative MFA', () => {
  const rawToken = 'synthetic-app-refresh-token';
  const tokenHash = argon2.hash(rawToken);
  const payload = {
    sub: 'user-id',
    sid: 'session-id',
    familyId: 'family-id',
    type: 'refresh',
    mfa: true,
  };
  const account = {
    status: UserStatus.ACTIVE,
    roles: [{ role: { name: RoleName.ADMIN as RoleName } }],
    twoFactor: { enabled: true } as { enabled: boolean } | null,
  };
  let session: {
    id: string;
    userId: string;
    familyId: string;
    tokenHash: string;
    revokedAt: Date | null;
    expiresAt: Date;
  };
  const refreshSession = {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const prisma = {
    refreshSession,
    $transaction: (run: (tx: { refreshSession: typeof refreshSession }) => unknown) =>
      Promise.resolve(run({ refreshSession })),
  };
  const jwt = {
    verifyAsync: jest.fn(),
    signAsync: jest.fn().mockResolvedValue('new-token'),
    decode: jest.fn().mockReturnValue({ exp: 1999999999 }),
  };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    jwt as unknown as JwtService,
    new ConfigService({
      auth: { accessSecret: 'synthetic-access-secret', refreshSecret: 'synthetic-refresh-secret' },
    }),
    {} as AuthAttemptLimiter,
  );

  beforeEach(async () => {
    jest.clearAllMocks();
    payload.mfa = true;
    account.roles = [{ role: { name: RoleName.ADMIN } }];
    account.twoFactor = { enabled: true };
    session = {
      id: 'session-id',
      userId: 'user-id',
      familyId: 'family-id',
      tokenHash: await tokenHash,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    jwt.verifyAsync.mockImplementation(() => Promise.resolve({ ...payload }));
    refreshSession.findUnique.mockImplementation(({ include }) =>
      Promise.resolve({
        ...session,
        user: {
          status: account.status,
          roles: account.roles,
          ...(include.user.include.twoFactor ? { twoFactor: account.twoFactor } : {}),
        },
      }),
    );
    refreshSession.updateMany.mockImplementation(({ where, data }) => {
      if (
        where.familyId === session.familyId &&
        where.userId === session.userId &&
        !session.revokedAt
      ) {
        session.revokedAt = data.revokedAt;
        return Promise.resolve({ count: 1 });
      }
      return Promise.resolve({ count: 0 });
    });
  });

  it.each([null, { enabled: false }])(
    'revokes an ADMIN refresh family when the current factor is %p',
    async (factor) => {
      account.twoFactor = factor;
      await expect(service.refresh(rawToken)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(session.revokedAt).toBeInstanceOf(Date);
      expect(jwt.signAsync).not.toHaveBeenCalled();
      expect(refreshSession.create).not.toHaveBeenCalled();
    },
  );

  it('requires fresh MFA login after a student refresh is promoted to ADMIN', async () => {
    payload.mfa = false;
    await expect(service.refresh(rawToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(session.revokedAt).toBeInstanceOf(Date);
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('preserves a valid ADMIN refresh with current factor and MFA proof', async () => {
    await expect(service.refresh(rawToken)).resolves.toMatchObject({
      accessToken: 'new-token',
      refreshToken: 'new-token',
    });
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'access', roles: [RoleName.ADMIN], mfa: true }),
      expect.anything(),
    );
  });

  it('preserves legacy student refresh without MFA or an enrolled factor', async () => {
    payload.mfa = false;
    account.roles = [{ role: { name: RoleName.PASSENGER } }];
    account.twoFactor = null;
    await expect(service.refresh(rawToken)).resolves.toMatchObject({ accessToken: 'new-token' });
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'access', roles: [RoleName.PASSENGER], mfa: false }),
      expect.anything(),
    );
  });
});
