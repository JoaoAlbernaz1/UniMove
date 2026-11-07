jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'RECOVERYSECRET'),
  generateURI: jest.fn(() => 'otpauth://totp/fixture'),
  verify: jest.fn().mockResolvedValue({ valid: true }),
}));

import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { verify } from 'otplib';
import type { PrismaService } from '../../database/prisma.service';
import {
  AdminPermission,
  AdminRecoveryStatus,
  RoleName,
  UserStatus,
} from '../../generated/prisma/enums';
import type { AuthAttemptLimiter } from '../auth/auth-attempt-limiter';
import type { MailDelivery, MailService } from '../mail/mail.service';
import { AdminRecoveryService } from './admin-recovery.service';
import type { AdminReauthService } from './admin-reauth.service';
import { hashToken } from './admin-tokens';

const PANEL = 'https://painel.test';
const PASSWORD = 'SenhaForte123!';
const NEW_PASSWORD = 'OutraSenhaForte456!';

describe('AdminRecoveryService', () => {
  type Reset = {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    usedAt: Date | null;
  };
  type Recovery = {
    id: string;
    userId: string;
    status: AdminRecoveryStatus;
    reason: string;
    tokenHash: string | null;
    expiresAt: Date;
    completedAt: Date | null;
  };

  let account: {
    id: string;
    fullName: string;
    institutionalEmail: string;
    passwordHash: string;
    status: UserStatus;
    deletedAt: Date | null;
    roles: { role: { name: RoleName } }[];
  };
  let resets: Reset[];
  let recoveries: Recovery[];
  let factor: { secret: string; enabled: boolean; recoveryCodes: string[] } | null;
  let audits: { action: string }[];
  let revokedAllSessions: number;
  let mailed: { to: string; subject: string; text: string }[];
  let reviewers: { fullName: string; institutionalEmail: string }[];

  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    adminPasswordReset: {
      create: jest.fn(({ data }: { data: Omit<Reset, 'id' | 'usedAt'> }) => {
        const reset = { id: `reset-${resets.length + 1}`, usedAt: null, ...data };
        resets.push(reset);
        return Promise.resolve(reset);
      }),
      findUnique: jest.fn(({ where }: { where: { tokenHash: string } }) => {
        const reset = resets.find((r) => r.tokenHash === where.tokenHash);
        return Promise.resolve(reset ? { ...reset, user: account } : null);
      }),
      updateMany: jest.fn(
        ({ where, data }: { where: { id?: string; userId?: string }; data: { usedAt: Date } }) => {
          const matches = resets.filter(
            (r) =>
              !r.usedAt &&
              (!where.id || r.id === where.id) &&
              (!where.userId || r.userId === where.userId),
          );
          matches.forEach((r) => Object.assign(r, data));
          return Promise.resolve({ count: matches.length });
        },
      ),
    },
    adminMfaRecovery: {
      create: jest.fn(
        ({ data }: { data: Omit<Recovery, 'id' | 'status' | 'tokenHash' | 'completedAt'> }) => {
          if (
            recoveries.some(
              (r) =>
                r.userId === data.userId &&
                (
                  [
                    AdminRecoveryStatus.PENDING,
                    AdminRecoveryStatus.APPROVED,
                  ] as AdminRecoveryStatus[]
                ).includes(r.status),
            )
          )
            return Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' }));
          const recovery: Recovery = {
            id: `recovery-${recoveries.length + 1}`,
            status: AdminRecoveryStatus.PENDING,
            tokenHash: null,
            completedAt: null,
            ...data,
          };
          recoveries.push(recovery);
          return Promise.resolve(recovery);
        },
      ),
      findUnique: jest.fn(({ where }: { where: { id?: string; tokenHash?: string } }) => {
        const recovery = recoveries.find(
          (r) =>
            (where.id && r.id === where.id) || (where.tokenHash && r.tokenHash === where.tokenHash),
        );
        return Promise.resolve(
          recovery
            ? {
                ...recovery,
                user: {
                  fullName: account.fullName,
                  institutionalEmail: account.institutionalEmail,
                },
              }
            : null,
        );
      }),
      update: jest.fn(({ where, data }: { where: { id: string }; data: Partial<Recovery> }) => {
        const recovery = recoveries.find((r) => r.id === where.id)!;
        Object.assign(recovery, data);
        return Promise.resolve(recovery);
      }),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string; status: AdminRecoveryStatus };
          data: Partial<Recovery>;
        }) => {
          const recovery = recoveries.find((r) => r.id === where.id && r.status === where.status);
          if (!recovery) return Promise.resolve({ count: 0 });
          Object.assign(recovery, data);
          return Promise.resolve({ count: 1 });
        },
      ),
    },
    user: {
      update: jest.fn(({ data }: { data: { passwordHash: string } }) => {
        account.passwordHash = data.passwordHash;
        return Promise.resolve(account);
      }),
      findUnique: jest.fn(() => Promise.resolve({ fullName: 'Gestor' })),
      findUniqueOrThrow: jest.fn(() => Promise.resolve(account)),
    },
    twoFactorAuth: {
      upsert: jest.fn(
        ({ create, update }: { create: { secret: string }; update: { secret: string } }) => {
          factor = factor
            ? { secret: update.secret, enabled: false, recoveryCodes: [] }
            : { secret: create.secret, enabled: false, recoveryCodes: [] };
          return Promise.resolve(factor);
        },
      ),
      findUnique: jest.fn(() => Promise.resolve(factor)),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { enabled: boolean; secret: string };
          data: { enabled: boolean; recoveryCodes: string[] };
        }) => {
          if (!factor || factor.enabled !== where.enabled || factor.secret !== where.secret)
            return Promise.resolve({ count: 0 });
          factor = { ...factor, ...data };
          return Promise.resolve({ count: 1 });
        },
      ),
    },
    refreshSession: {
      updateMany: jest.fn(() => {
        revokedAllSessions += 1;
        return Promise.resolve({ count: 3 });
      }),
    },
    auditLog: {
      create: jest.fn(({ data }: { data: { action: string } }) => {
        audits.push(data);
        return Promise.resolve(data);
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function' ? (arg as (c: typeof tx) => unknown)(tx) : Promise.all(arg as []),
    ),
    user: {
      findUnique: jest.fn(() => Promise.resolve(account)),
      findMany: jest.fn(() => Promise.resolve(reviewers)),
    },
    auditLog: tx.auditLog,
    adminMfaRecovery: tx.adminMfaRecovery,
  };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'admin.panelUrl') return PANEL;
      if (key === 'admin.passwordResetTtlMinutes') return 30;
      if (key === 'admin.mfaRecoveryTtlHours') return 24;
      return undefined;
    }),
  };
  const mail = {
    send: jest.fn(
      (message: { to: string; subject: string; text: string }): Promise<MailDelivery> => {
        mailed.push(message);
        return Promise.resolve('SENT');
      },
    ),
  };
  const limiter = {
    assertAllowed: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
    reset: jest.fn().mockResolvedValue(undefined),
    claimCode: jest.fn().mockResolvedValue(true),
  };
  const reauth = { assertReauthenticated: jest.fn().mockResolvedValue(undefined) };
  const service = new AdminRecoveryService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    mail as unknown as MailService,
    limiter as unknown as AuthAttemptLimiter,
    reauth as unknown as AdminReauthService,
  );
  const tokenFromMail = (index = -1) =>
    mailed.at(index)!.text.match(/https:\/\/\S+token=([\w-]+)/)![1];

  beforeEach(async () => {
    jest.clearAllMocks();
    (verify as jest.Mock).mockResolvedValue({ valid: true });
    limiter.claimCode.mockResolvedValue(true);
    account = {
      id: 'admin-id',
      fullName: 'Pessoa Administradora',
      institutionalEmail: 'admin@ucb.edu.br',
      passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
      status: UserStatus.ACTIVE,
      deletedAt: null,
      roles: [{ role: { name: RoleName.ADMIN } }],
    };
    resets = [];
    recoveries = [];
    factor = { secret: 'cifrado-antigo', enabled: true, recoveryCodes: ['hash-antigo'] };
    audits = [];
    revokedAllSessions = 0;
    mailed = [];
    reviewers = [{ fullName: 'Gestor', institutionalEmail: 'gestor@ucb.edu.br' }];
    mail.send.mockImplementation((message) => {
      mailed.push(message);
      return Promise.resolve('SENT');
    });
  });

  // -------------------------------------------------- redefinição de senha

  it('responde igual para conta existente e inexistente', async () => {
    const real = await service.requestPasswordReset({ email: account.institutionalEmail });
    const previous = account.roles;
    account.roles = [];
    const fake = await service.requestPasswordReset({ email: 'ninguem@ucb.edu.br' });
    account.roles = previous;
    expect(fake).toEqual(real);
    expect(resets).toHaveLength(1);
  });

  it('não emite token para conta que não é administradora', async () => {
    account.roles = [];
    await service.requestPasswordReset({ email: account.institutionalEmail });
    expect(resets).toHaveLength(0);
    expect(mailed).toHaveLength(0);
  });

  it('guarda só o hash do token e manda o link por e-mail', async () => {
    await service.requestPasswordReset({ email: account.institutionalEmail });
    const token = tokenFromMail();
    expect(resets[0].tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(audits)).not.toContain(token);
  });

  it('pedido novo invalida o link anterior', async () => {
    await service.requestPasswordReset({ email: account.institutionalEmail });
    const first = tokenFromMail();
    await service.requestPasswordReset({ email: account.institutionalEmail });
    expect(resets[0].usedAt).not.toBeNull();
    await expect(
      service.confirmPasswordReset({ token: first, password: NEW_PASSWORD }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('troca a senha, derruba todas as sessões e mantém o segundo fator', async () => {
    await service.requestPasswordReset({ email: account.institutionalEmail });
    const token = tokenFromMail();
    const previousHash = account.passwordHash;
    const result = await service.confirmPasswordReset({ token, password: NEW_PASSWORD });
    expect(result).toEqual({ updated: true, twoFactorStillRequired: true });
    expect(account.passwordHash).not.toBe(previousHash);
    expect(await argon2.verify(account.passwordHash, NEW_PASSWORD)).toBe(true);
    expect(revokedAllSessions).toBe(1);
    expect(factor).toMatchObject({ enabled: true });
    expect(audits.map((a) => a.action)).toContain('ADMIN_PASSWORD_RESET_COMPLETED');
    expect(mailed.at(-1)!.subject).toContain('alterada');
  });

  it('o token de senha serve uma única vez', async () => {
    await service.requestPasswordReset({ email: account.institutionalEmail });
    const token = tokenFromMail();
    await service.confirmPasswordReset({ token, password: NEW_PASSWORD });
    await expect(
      service.confirmPasswordReset({ token, password: 'TerceiraSenha789!' }),
    ).rejects.toMatchObject({ response: { code: 'ADMIN_TOKEN_INVALID' } });
  });

  it('recusa token expirado', async () => {
    await service.requestPasswordReset({ email: account.institutionalEmail });
    const token = tokenFromMail();
    resets[0].expiresAt = new Date(Date.now() - 1000);
    await expect(
      service.confirmPasswordReset({ token, password: NEW_PASSWORD }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // ------------------------------------------ recuperação do segundo fator

  it('exige a senha: só o acesso ao e-mail não abre pedido', async () => {
    await service.requestMfaRecovery({
      email: account.institutionalEmail,
      password: 'errada',
      reason: 'Perdi o celular com o autenticador',
    });
    expect(recoveries).toHaveLength(0);
    expect(mailed).toHaveLength(0);
  });

  it('abre pedido com a senha correta e avisa quem pode aprovar', async () => {
    await service.requestMfaRecovery({
      email: account.institutionalEmail,
      password: PASSWORD,
      reason: 'Perdi o celular com o autenticador',
    });
    expect(recoveries[0]).toMatchObject({ status: AdminRecoveryStatus.PENDING });
    expect(mailed.map((m) => m.to)).toEqual(['gestor@ucb.edu.br']);
    expect(audits.map((a) => a.action)).toContain('ADMIN_MFA_RECOVERY_REQUESTED');
  });

  it('não abre dois pedidos em aberto para a mesma conta', async () => {
    const input = {
      email: account.institutionalEmail,
      password: PASSWORD,
      reason: 'Perdi o celular com o autenticador',
    };
    await service.requestMfaRecovery(input);
    await expect(service.requestMfaRecovery(input)).resolves.toMatchObject({ accepted: true });
    expect(recoveries).toHaveLength(1);
  });

  it('ninguém aprova o próprio pedido', async () => {
    await service.requestMfaRecovery({
      email: account.institutionalEmail,
      password: PASSWORD,
      reason: 'Perdi o celular com o autenticador',
    });
    await expect(
      service.reviewMfaRecovery(
        { id: account.id, roles: [RoleName.ADMIN], mfa: true },
        'recovery-1',
        {
          approve: true,
          password: PASSWORD,
          twoFactorCode: '123456',
        },
      ),
    ).rejects.toMatchObject({ response: { code: 'CANNOT_REVIEW_OWN_RECOVERY' } });
    expect(recoveries[0].tokenHash).toBeNull();
  });

  it('aprovar exige reautenticação do revisor', async () => {
    await service.requestMfaRecovery({
      email: account.institutionalEmail,
      password: PASSWORD,
      reason: 'Perdi o celular com o autenticador',
    });
    reauth.assertReauthenticated.mockRejectedValueOnce(new Error('reauth'));
    await expect(
      service.reviewMfaRecovery(
        { id: 'gestor-id', roles: [RoleName.ADMIN], mfa: true },
        'recovery-1',
        {
          approve: true,
          password: PASSWORD,
          twoFactorCode: '123456',
        },
      ),
    ).rejects.toThrow('reauth');
    expect(recoveries[0].tokenHash).toBeNull();
  });

  const openAndApprove = async () => {
    await service.requestMfaRecovery({
      email: account.institutionalEmail,
      password: PASSWORD,
      reason: 'Perdi o celular com o autenticador',
    });
    await service.reviewMfaRecovery(
      { id: 'gestor-id', roles: [RoleName.ADMIN], mfa: true },
      'recovery-1',
      { approve: true, password: PASSWORD, twoFactorCode: '123456' },
    );
    return tokenFromMail();
  };

  it('aprovação gera token de uso único e manda para quem pediu', async () => {
    const token = await openAndApprove();
    expect(recoveries[0]).toMatchObject({
      status: AdminRecoveryStatus.APPROVED,
      tokenHash: hashToken(token),
    });
    expect(mailed.at(-1)!.to).toBe(account.institutionalEmail);
    expect(audits.map((a) => a.action)).toContain('ADMIN_MFA_RECOVERY_APPROVED');
  });

  it('recusar avisa quem pediu e não gera token', async () => {
    await service.requestMfaRecovery({
      email: account.institutionalEmail,
      password: PASSWORD,
      reason: 'Perdi o celular com o autenticador',
    });
    await service.reviewMfaRecovery(
      { id: 'gestor-id', roles: [RoleName.ADMIN], mfa: true },
      'recovery-1',
      { approve: false, password: PASSWORD, twoFactorCode: '123456', note: 'Procure a equipe' },
    );
    expect(recoveries[0]).toMatchObject({ status: AdminRecoveryStatus.REJECTED, tokenHash: null });
    expect(mailed.at(-1)!.subject).toContain('recusada');
  });

  it('o link aprovado ainda pede a senha e invalida o fator antigo', async () => {
    const token = await openAndApprove();
    await expect(service.startMfaRecovery({ token, password: 'errada' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(factor).toMatchObject({ enabled: true, recoveryCodes: ['hash-antigo'] });
    const result = await service.startMfaRecovery({ token, password: PASSWORD });
    expect(result.twoFactor.secret).toBe('RECOVERYSECRET');
    expect(factor).toMatchObject({ enabled: false, recoveryCodes: [] });
    expect(revokedAllSessions).toBe(1);
  });

  it('confirma o novo autenticador, entrega códigos novos e conclui o pedido', async () => {
    const token = await openAndApprove();
    await service.startMfaRecovery({ token, password: PASSWORD });
    const result = await service.confirmMfaRecovery({ token, code: '123456' });
    expect(result.recoveryCodes).toHaveLength(8);
    expect(factor!.enabled).toBe(true);
    for (const [index, code] of result.recoveryCodes.entries())
      expect(await argon2.verify(factor!.recoveryCodes[index], code.replace('-', ''))).toBe(true);
    expect(recoveries[0].status).toBe(AdminRecoveryStatus.COMPLETED);
    expect(JSON.stringify(audits)).not.toContain(result.recoveryCodes[0]);
  });

  it('o token de recuperação não serve duas vezes', async () => {
    const token = await openAndApprove();
    await service.startMfaRecovery({ token, password: PASSWORD });
    await service.confirmMfaRecovery({ token, code: '123456' });
    await expect(service.confirmMfaRecovery({ token, code: '123456' })).rejects.toMatchObject({
      response: { code: 'ADMIN_TOKEN_INVALID' },
    });
  });

  it('recusa código inválido e código repetido na confirmação', async () => {
    const token = await openAndApprove();
    await service.startMfaRecovery({ token, password: PASSWORD });
    (verify as jest.Mock).mockResolvedValue({ valid: false });
    await expect(service.confirmMfaRecovery({ token, code: '000000' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    (verify as jest.Mock).mockResolvedValue({ valid: true });
    limiter.claimCode.mockResolvedValue(false);
    await expect(service.confirmMfaRecovery({ token, code: '123456' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(factor!.enabled).toBe(false);
  });

  it('recusa aprovar pedido expirado', async () => {
    await service.requestMfaRecovery({
      email: account.institutionalEmail,
      password: PASSWORD,
      reason: 'Perdi o celular com o autenticador',
    });
    recoveries[0].expiresAt = new Date(Date.now() - 1000);
    await expect(
      service.reviewMfaRecovery(
        { id: 'gestor-id', roles: [RoleName.ADMIN], mfa: true },
        'recovery-1',
        {
          approve: true,
          password: PASSWORD,
          twoFactorCode: '123456',
        },
      ),
    ).rejects.toMatchObject({ response: { code: 'RECOVERY_EXPIRED' } });
  });

  it('só avisa revisores com permissão de gerenciar acessos', async () => {
    await service.requestMfaRecovery({
      email: account.institutionalEmail,
      password: PASSWORD,
      reason: 'Perdi o celular com o autenticador',
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          adminAccess: { is: { permissions: { has: AdminPermission.MANAGE_ADMINS } } },
        }),
      }),
    );
  });

  it('ConflictException é o tipo dos bloqueios de estado do pedido', async () => {
    await service.requestMfaRecovery({
      email: account.institutionalEmail,
      password: PASSWORD,
      reason: 'Perdi o celular com o autenticador',
    });
    recoveries[0].status = AdminRecoveryStatus.COMPLETED;
    await expect(
      service.reviewMfaRecovery(
        { id: 'gestor-id', roles: [RoleName.ADMIN], mfa: true },
        'recovery-1',
        {
          approve: true,
          password: PASSWORD,
          twoFactorCode: '123456',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
