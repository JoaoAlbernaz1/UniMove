jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'REPLACEMENTSECRET'),
  generateURI: jest.fn(() => 'otpauth://totp/fixture'),
  verify: jest.fn().mockResolvedValue({ valid: true }),
}));

import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { verify } from 'otplib';
import type { PrismaService } from '../../database/prisma.service';
import { RoleName, SessionScope, UserStatus } from '../../generated/prisma/enums';
import type { AuthAttemptLimiter } from '../auth/auth-attempt-limiter';
import { decryptTwoFactorSecret, encryptTwoFactorSecret } from '../auth/two-factor-crypto';
import type { MailDelivery, MailService } from '../mail/mail.service';
import { AdminSecurityService } from './admin-security.service';
import type { AdminReauthService } from './admin-reauth.service';

const PASSWORD = 'SenhaForte123!';
const NEW_PASSWORD = 'OutraSenhaForte456!';
const actor = { id: 'admin-id', roles: [RoleName.ADMIN], mfa: true, sid: 'sessao-atual' };
const reauthCredentials = { password: PASSWORD, twoFactorCode: '123456' };

describe('AdminSecurityService', () => {
  let account: {
    id: string;
    fullName: string;
    institutionalEmail: string;
    passwordHash: string;
    status: UserStatus;
    createdAt: Date;
    roles: { role: { name: RoleName } }[];
    adminAccess: { permissions: string[]; updatedAt: Date } | null;
    twoFactor: {
      enabled: boolean;
      secret: string;
      recoveryCodes: string[];
      updatedAt: Date;
    } | null;
    refreshSessions: { id: string; userAgent: string | null; createdAt: Date }[];
  };
  let audits: { action: string; metadata?: unknown }[];
  let revokedWhere: Record<string, unknown> | undefined;
  let mailed: number;

  const tx = {
    user: {
      update: jest.fn(({ data }: { data: { passwordHash: string } }) => {
        account.passwordHash = data.passwordHash;
        return Promise.resolve(account);
      }),
    },
    twoFactorAuth: {
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { enabled: boolean; updatedAt?: Date };
          data: { secret?: string; recoveryCodes: string[] };
        }) => {
          if (
            !account.twoFactor ||
            account.twoFactor.enabled !== where.enabled ||
            (where.updatedAt && account.twoFactor.updatedAt.getTime() !== where.updatedAt.getTime())
          )
            return Promise.resolve({ count: 0 });
          account.twoFactor = {
            ...account.twoFactor,
            ...data,
            // A coluna @updatedAt muda na confirmação, como no PostgreSQL real.
            updatedAt: new Date(account.twoFactor.updatedAt.getTime() + 1000),
          };
          return Promise.resolve({ count: 1 });
        },
      ),
    },
    refreshSession: {
      updateMany: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        revokedWhere = where;
        return Promise.resolve({ count: 2 });
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
    $transaction: jest.fn((callback: (c: typeof tx) => unknown) => callback(tx)),
    user: {
      findUniqueOrThrow: jest.fn(() => Promise.resolve(account)),
    },
    twoFactorAuth: tx.twoFactorAuth,
    auditLog: {
      create: tx.auditLog.create,
      findFirst: jest.fn(({ where }: { where: { action: { in: string[] } } }) =>
        Promise.resolve(
          where.action.in.includes('ADMIN_LOGIN')
            ? { createdAt: new Date('2026-11-07T09:00:00Z') }
            : null,
        ),
      ),
    },
  };
  const config = {
    get: jest.fn((key: string) => (key === 'admin.sessionMaxHours' ? 12 : undefined)),
    getOrThrow: jest.fn(() => 'segredo-de-teste-com-mais-de-32-caracteres'),
  };
  const jwt = new JwtService({});
  const reauth = { assertReauthenticated: jest.fn().mockResolvedValue(undefined) };
  const limiter = {
    assertAllowed: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
    reset: jest.fn().mockResolvedValue(undefined),
    claimCode: jest.fn().mockResolvedValue(true),
  };
  const mail = {
    send: jest.fn((): Promise<MailDelivery> => {
      mailed += 1;
      return Promise.resolve('SENT');
    }),
  };
  const service = new AdminSecurityService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    jwt,
    reauth as unknown as AdminReauthService,
    limiter as unknown as AuthAttemptLimiter,
    mail as unknown as MailService,
  );

  beforeEach(async () => {
    jest.clearAllMocks();
    (verify as jest.Mock).mockResolvedValue({ valid: true });
    limiter.claimCode.mockResolvedValue(true);
    audits = [];
    revokedWhere = undefined;
    mailed = 0;
    account = {
      id: actor.id,
      fullName: 'Pessoa Administradora',
      institutionalEmail: 'admin@ucb.edu.br',
      passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
      status: UserStatus.ACTIVE,
      createdAt: new Date('2026-01-10T12:00:00Z'),
      roles: [{ role: { name: RoleName.ADMIN } }],
      adminAccess: { permissions: ['MANAGE_ADMINS'], updatedAt: new Date() },
      twoFactor: {
        enabled: true,
        secret: encryptTwoFactorSecret('SEGREDOATUAL'),
        recoveryCodes: ['hash-antigo-1', 'hash-antigo-2'],
        updatedAt: new Date('2026-02-12T09:10:00Z'),
      },
      refreshSessions: [
        { id: 'sessao-atual', userAgent: 'Chrome no macOS', createdAt: new Date() },
        { id: 'sessao-outra', userAgent: 'Safari no iPhone', createdAt: new Date() },
      ],
    };
  });

  // ------------------------------------------------------------- resumo

  it('o resumo traz 2FA, sessões, último acesso e o escopo da própria conta', async () => {
    const result = await service.overview(actor);
    expect(result.account).toMatchObject({
      email: 'admin@ucb.edu.br',
      permissions: ['MANAGE_ADMINS'],
    });
    expect(result.twoFactor).toMatchObject({ enabled: true, recoveryCodesRemaining: 2 });
    expect(result.sessions).toMatchObject({ active: 2, others: 1 });
    expect(result.sessions.currentUserAgent).toBe('Chrome no macOS');
    expect(result.lastLoginAt).toEqual(new Date('2026-11-07T09:00:00Z'));
    expect(result.sessionMaxHours).toBe(12);
  });

  it('senha nunca trocada vem como null, sem data inventada', async () => {
    const result = await service.overview(actor);
    expect(result.password.changedAt).toBeNull();
  });

  it('o resumo não devolve segredo nem hash de código de recuperação', async () => {
    const dump = JSON.stringify(await service.overview(actor));
    expect(dump).not.toContain('SEGREDOATUAL');
    expect(dump).not.toContain('hash-antigo-1');
    expect(dump).not.toContain(account.passwordHash);
  });

  // ------------------------------------------------------- troca de senha

  it('troca a senha, mantém a sessão atual e derruba as outras', async () => {
    const result = await service.changePassword(actor, {
      currentPassword: PASSWORD,
      password: NEW_PASSWORD,
    });
    expect(result).toMatchObject({ updated: true, sessionsRevoked: 2 });
    expect(await argon2.verify(account.passwordHash, NEW_PASSWORD)).toBe(true);
    // A sessão de quem acabou de provar a senha não cai.
    expect(revokedWhere).toMatchObject({ id: { not: 'sessao-atual' } });
    expect(audits.map((a) => a.action)).toContain('ADMIN_PASSWORD_CHANGED');
    expect(mailed).toBe(1);
  });

  it('recusa senha atual errada e registra a tentativa', async () => {
    await expect(
      service.changePassword(actor, { currentPassword: 'errada', password: NEW_PASSWORD }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_CREDENTIALS' } });
    expect(limiter.recordFailure).toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('recusa repetir a senha atual como nova', async () => {
    await expect(
      service.changePassword(actor, { currentPassword: PASSWORD, password: PASSWORD }),
    ).rejects.toMatchObject({ response: { code: 'PASSWORD_UNCHANGED' } });
  });

  // ------------------------------------------- códigos de recuperação

  it('gera oito códigos novos, guarda só hashes e audita', async () => {
    const result = await service.regenerateRecoveryCodes(actor, reauthCredentials);
    expect(result.recoveryCodes).toHaveLength(8);
    expect(result.remaining).toBe(8);
    for (const [index, code] of result.recoveryCodes.entries())
      expect(
        await argon2.verify(account.twoFactor!.recoveryCodes[index], code.replace('-', '')),
      ).toBe(true);
    expect(account.twoFactor!.recoveryCodes).not.toContain('hash-antigo-1');
    expect(JSON.stringify(audits)).not.toContain(result.recoveryCodes[0]);
    expect(audits.map((a) => a.action)).toContain('ADMIN_RECOVERY_CODES_REGENERATED');
  });

  it('gerar códigos exige reautenticação', async () => {
    reauth.assertReauthenticated.mockRejectedValueOnce(new Error('reauth'));
    await expect(service.regenerateRecoveryCodes(actor, reauthCredentials)).rejects.toThrow(
      'reauth',
    );
    expect(account.twoFactor!.recoveryCodes).toEqual(['hash-antigo-1', 'hash-antigo-2']);
  });

  it('recusa gerar códigos sem segundo fator ativo', async () => {
    account.twoFactor = { ...account.twoFactor!, enabled: false };
    await expect(service.regenerateRecoveryCodes(actor, reauthCredentials)).rejects.toMatchObject({
      response: { code: 'TWO_FACTOR_NOT_ENABLED' },
    });
  });

  // ------------------------------------- substituição do autenticador

  it('começar a substituição não desativa o fator atual', async () => {
    const before = account.twoFactor!.secret;
    const result = await service.startAuthenticatorReplacement(actor, reauthCredentials);
    expect(result.twoFactor.secret).toBe('REPLACEMENTSECRET');
    expect(result.twoFactor.qrCode).toMatch(/^data:image\/png;base64,/);
    expect(result.setupTicket.split('.')).toHaveLength(3);
    // O que vale hoje continua valendo: desistir no meio não tranca ninguém.
    expect(account.twoFactor!.secret).toBe(before);
    expect(account.twoFactor!.enabled).toBe(true);
    expect(audits.map((a) => a.action)).toContain('ADMIN_2FA_REPLACEMENT_STARTED');
  });

  it('o ticket não entrega o segredo novo sem a chave do servidor', async () => {
    const { setupTicket } = await service.startAuthenticatorReplacement(actor, reauthCredentials);
    const payload = JSON.parse(
      Buffer.from(setupTicket.split('.')[1], 'base64url').toString('utf8'),
    ) as { secret: string };
    expect(payload.secret).not.toContain('REPLACEMENTSECRET');
    expect(decryptTwoFactorSecret(payload.secret).secret).toBe('REPLACEMENTSECRET');
  });

  it('confirmar troca o segredo e entrega códigos novos, uma vez', async () => {
    const { setupTicket } = await service.startAuthenticatorReplacement(actor, reauthCredentials);
    const result = await service.confirmAuthenticatorReplacement(actor, {
      setupTicket,
      code: '123456',
    });
    expect(result.replaced).toBe(true);
    expect(result.recoveryCodes).toHaveLength(8);
    expect(result.sessionsRevoked).toBe(2);
    expect(revokedWhere).toMatchObject({
      userId: actor.id,
      scope: SessionScope.ADMIN,
      id: { not: actor.sid },
    });
    expect(decryptTwoFactorSecret(account.twoFactor!.secret).secret).toBe('REPLACEMENTSECRET');
    expect(account.twoFactor!.recoveryCodes).not.toContain('hash-antigo-1');
    expect(audits.map((a) => a.action)).toContain('ADMIN_2FA_REPLACED');
  });


  it('um ticket já concluído não pode substituir novamente o fator mesmo com novo TOTP', async () => {
    const { setupTicket } = await service.startAuthenticatorReplacement(actor, reauthCredentials);
    await service.confirmAuthenticatorReplacement(actor, { setupTicket, code: '123456' });
    const savedSecret = account.twoFactor!.secret;
    const auditsAfterSuccess = audits.length;
    await expect(
      service.confirmAuthenticatorReplacement(actor, { setupTicket, code: '654321' }),
    ).rejects.toMatchObject({ response: { code: 'ADMIN_FACTOR_SETUP_STALE' } });
    expect(account.twoFactor!.secret).toBe(savedSecret);
    expect(audits).toHaveLength(auditsAfterSuccess);
    expect(tx.refreshSession.updateMany).toHaveBeenCalledTimes(1);
  });

  it('um ticket antigo é invalidado se os códigos de recuperação foram trocados', async () => {
    const { setupTicket } = await service.startAuthenticatorReplacement(actor, reauthCredentials);
    await service.regenerateRecoveryCodes(actor, reauthCredentials);
    await expect(
      service.confirmAuthenticatorReplacement(actor, { setupTicket, code: '123456' }),
    ).rejects.toMatchObject({ response: { code: 'ADMIN_FACTOR_SETUP_STALE' } });
    expect(decryptTwoFactorSecret(account.twoFactor!.secret).secret).toBe('SEGREDOATUAL');
  });

  it('recusa ticket inválido, de outra conta e expirado', async () => {
    await expect(
      service.confirmAuthenticatorReplacement(actor, { setupTicket: 'nao-e-jwt', code: '123456' }),
    ).rejects.toMatchObject({ response: { code: 'ADMIN_FACTOR_SETUP_EXPIRED' } });

    const outro = await jwt.signAsync(
      { sub: 'outra-conta', type: 'admin_factor_setup', secret: 'x' },
      { secret: 'segredo-de-teste-com-mais-de-32-caracteres', expiresIn: 60 },
    );
    await expect(
      service.confirmAuthenticatorReplacement(actor, { setupTicket: outro, code: '123456' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const expirado = await jwt.signAsync(
      { sub: actor.id, type: 'admin_factor_setup', secret: 'x' },
      { secret: 'segredo-de-teste-com-mais-de-32-caracteres', expiresIn: -10 },
    );
    await expect(
      service.confirmAuthenticatorReplacement(actor, { setupTicket: expirado, code: '123456' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(decryptTwoFactorSecret(account.twoFactor!.secret).secret).toBe('SEGREDOATUAL');
  });

  it('recusa código errado e código repetido, preservando o fator atual', async () => {
    const { setupTicket } = await service.startAuthenticatorReplacement(actor, reauthCredentials);
    (verify as jest.Mock).mockResolvedValue({ valid: false });
    await expect(
      service.confirmAuthenticatorReplacement(actor, { setupTicket, code: '000000' }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_CODE' } });
    (verify as jest.Mock).mockResolvedValue({ valid: true });
    limiter.claimCode.mockResolvedValue(false);
    await expect(
      service.confirmAuthenticatorReplacement(actor, { setupTicket, code: '123456' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(decryptTwoFactorSecret(account.twoFactor!.secret).secret).toBe('SEGREDOATUAL');
  });

  it('o escopo da sessão administrativa é o que a lista do resumo filtra', async () => {
    await service.overview(actor);
    expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          refreshSessions: expect.objectContaining({
            where: expect.objectContaining({ scope: SessionScope.ADMIN, revokedAt: null }),
          }),
        }),
      }),
    );
  });

  it('ConflictException é o tipo do bloqueio de fator ausente', async () => {
    account.twoFactor = null;
    await expect(
      service.startAuthenticatorReplacement(actor, reauthCredentials),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
