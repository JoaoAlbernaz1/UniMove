jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'INVITESECRET'),
  generateURI: jest.fn(() => 'otpauth://totp/fixture'),
  verify: jest.fn().mockResolvedValue({ valid: true }),
}));

import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { verify } from 'otplib';
import type { PrismaService } from '../../database/prisma.service';
import {
  AdminInviteStatus,
  AdminPermission,
  RoleName,
  UserStatus,
} from '../../generated/prisma/enums';
import type { AuthAttemptLimiter } from '../auth/auth-attempt-limiter';
import type { MailDelivery, MailService } from '../mail/mail.service';
import { AdminInvitesService } from './admin-invites.service';
import { hashToken } from './admin-tokens';

const PANEL = 'https://painel.test';
const PASSWORD = 'SenhaForte123!';
const actor = { id: 'manager-id', roles: [RoleName.ADMIN], mfa: true };

describe('AdminInvitesService', () => {
  type Invite = {
    id: string;
    email: string;
    fullName: string;
    tokenHash: string;
    permissions: AdminPermission[];
    status: AdminInviteStatus;
    invitedById: string;
    userId: string | null;
    expiresAt: Date;
    emailConfirmedAt: Date | null;
  };
  type Account = {
    id: string;
    institutionalEmail: string;
    passwordHash: string;
    status: UserStatus;
    deletedAt: Date | null;
    cpf?: string;
    roles: { role: { name: RoleName } }[];
    twoFactor?: { enabled: boolean } | null;
  };

  let invites: Invite[];
  let accounts: Account[];
  let factors: Record<string, { secret: string; enabled: boolean; recoveryCodes: string[] }>;
  let userRoles: { userId: string; roleId: string }[];
  let access: Record<string, { permissions: AdminPermission[]; grantedById: string | null }>;
  let audits: { action: string; entityId: string | null; metadata?: unknown }[];
  let revokedSessions: number;
  let mailed: { subject: string; to: string; text: string }[];

  const findInvite = (where: { tokenHash?: string; id?: string }) =>
    invites.find(
      (invite) =>
        (where.tokenHash && invite.tokenHash === where.tokenHash) ||
        (where.id && invite.id === where.id),
    ) ?? null;
  const findAccount = (where: { institutionalEmail?: string; id?: string; cpf?: string }) =>
    accounts.find(
      (account) =>
        (where.institutionalEmail && account.institutionalEmail === where.institutionalEmail) ||
        (where.id && account.id === where.id) ||
        (where.cpf && account.cpf === where.cpf),
    ) ?? null;

  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(0),
    adminInvite: {
      create: jest.fn(({ data }: { data: Omit<Invite, 'id' | 'status' | 'emailConfirmedAt'> }) => {
        if (invites.some((i) => i.email === data.email && i.status === AdminInviteStatus.PENDING))
          return Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' }));
        const invite: Invite = {
          id: `invite-${invites.length + 1}`,
          status: AdminInviteStatus.PENDING,
          emailConfirmedAt: null,
          ...data,
        };
        invites.push(invite);
        return Promise.resolve(invite);
      }),
      findUnique: jest.fn(({ where }: { where: { tokenHash?: string; id?: string } }) =>
        Promise.resolve(findInvite(where)),
      ),
      update: jest.fn(({ where, data }: { where: { id: string }; data: Partial<Invite> }) => {
        const invite = findInvite(where)!;
        Object.assign(invite, data);
        return Promise.resolve(invite);
      }),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id?: string; status?: AdminInviteStatus; email?: string };
          data: Partial<Invite>;
        }) => {
          const matches = invites.filter(
            (invite) =>
              (!where.id || invite.id === where.id) &&
              (!where.status || invite.status === where.status) &&
              (!where.email || invite.email === where.email),
          );
          matches.forEach((invite) => Object.assign(invite, data));
          return Promise.resolve({ count: matches.length });
        },
      ),
    },
    user: {
      findUnique: jest.fn(({ where }: { where: Record<string, string> }) =>
        Promise.resolve(findAccount(where)),
      ),
      create: jest.fn(({ data }: { data: Record<string, string> }) => {
        const account: Account = {
          id: `user-${accounts.length + 1}`,
          institutionalEmail: data.institutionalEmail,
          passwordHash: data.passwordHash,
          cpf: data.cpf,
          status: UserStatus.ACTIVE,
          deletedAt: null,
          roles: [],
          twoFactor: null,
        };
        accounts.push(account);
        return Promise.resolve({ id: account.id });
      }),
    },
    twoFactorAuth: {
      upsert: jest.fn(
        ({
          where,
          create,
          update,
        }: {
          where: { userId: string };
          create: { secret: string };
          update: { secret: string };
        }) => {
          factors[where.userId] = factors[where.userId]
            ? { ...factors[where.userId], ...update, enabled: false, recoveryCodes: [] }
            : { secret: create.secret, enabled: false, recoveryCodes: [] };
          return Promise.resolve(factors[where.userId]);
        },
      ),
      findUnique: jest.fn(({ where }: { where: { userId: string } }) =>
        Promise.resolve(factors[where.userId] ?? null),
      ),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { userId: string; enabled: boolean; secret: string };
          data: { enabled: boolean; recoveryCodes: string[] };
        }) => {
          const factor = factors[where.userId];
          if (!factor || factor.enabled !== where.enabled || factor.secret !== where.secret)
            return Promise.resolve({ count: 0 });
          factors[where.userId] = { ...factor, ...data };
          return Promise.resolve({ count: 1 });
        },
      ),
    },
    role: { findUnique: jest.fn(() => Promise.resolve({ id: 'role-admin' })) },
    userRole: {
      upsert: jest.fn(({ create }: { create: { userId: string; roleId: string } }) => {
        if (!userRoles.some((r) => r.userId === create.userId)) userRoles.push(create);
        const account = findAccount({ id: create.userId });
        if (account && !account.roles.length) account.roles = [{ role: { name: RoleName.ADMIN } }];
        return Promise.resolve(create);
      }),
    },
    adminAccess: {
      upsert: jest.fn(
        ({
          where,
          create,
        }: {
          where: { userId: string };
          create: { permissions: AdminPermission[]; grantedById: string | null };
        }) => {
          access[where.userId] = {
            permissions: create.permissions,
            grantedById: create.grantedById,
          };
          return Promise.resolve(access[where.userId]);
        },
      ),
    },
    auditLog: {
      create: jest.fn(({ data }: { data: { action: string; entityId: string | null } }) => {
        audits.push(data);
        return Promise.resolve(data);
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function' ? (arg as (c: typeof tx) => unknown)(tx) : Promise.all(arg as []),
    ),
    adminInvite: tx.adminInvite,
    user: tx.user,
    auditLog: tx.auditLog,
    refreshSession: {
      updateMany: jest.fn(() => {
        revokedSessions += 1;
        return Promise.resolve({ count: 1 });
      }),
    },
  };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'admin.panelUrl') return PANEL;
      if (key === 'admin.inviteTtlHours') return 72;
      if (key === 'auth.institutionalDomains') return ['ucb.edu.br'];
      if (key === 'admin.inviteEmailDomains') return [];
      return undefined;
    }),
  };
  const mail = {
    send: jest.fn(
      (message: { subject: string; to: string; text: string }): Promise<MailDelivery> => {
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
  const service = new AdminInvitesService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    mail as unknown as MailService,
    limiter as unknown as AuthAttemptLimiter,
  );

  /** O token em claro não existe no banco: pega do link enviado por e-mail. */
  const tokenFromMail = () => {
    const url = mailed.at(-1)!.text.match(/https:\/\/\S+token=([\w-]+)/);
    return url![1];
  };
  const invite = (overrides: Partial<Parameters<typeof service.create>[1]> = {}) =>
    service.create(actor, {
      email: 'novo@ucb.edu.br',
      fullName: 'Pessoa Convidada',
      permissions: [AdminPermission.MANAGE_USERS],
      ...overrides,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    (verify as jest.Mock).mockResolvedValue({ valid: true });
    limiter.claimCode.mockResolvedValue(true);
    invites = [];
    accounts = [
      {
        id: actor.id,
        institutionalEmail: 'gestor@ucb.edu.br',
        passwordHash: 'hash',
        status: UserStatus.ACTIVE,
        deletedAt: null,
        roles: [{ role: { name: RoleName.ADMIN } }],
        twoFactor: { enabled: true },
      },
    ];
    factors = {};
    userRoles = [];
    access = {};
    audits = [];
    revokedSessions = 0;
    mailed = [];
    mail.send.mockImplementation((message) => {
      mailed.push(message);
      return Promise.resolve('SENT');
    });
  });

  // ------------------------------------------------------------- emissão

  it('emite convite com token só em hash, envia o link e audita sem o token', async () => {
    const result = await invite();
    expect(result.delivery).toBe('SENT');
    expect(invites[0].tokenHash).toHaveLength(64);
    const token = tokenFromMail();
    expect(invites[0].tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(audits)).not.toContain(token);
    expect(audits.map((a) => a.action)).toContain('ADMIN_INVITE_CREATED');
  });

  it('recusa e-mail fora do domínio institucional antes de tocar o banco', async () => {
    await expect(invite({ email: 'pessoa@gmail.com' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('recusa convite para quem já é administrador com segundo fator ativo', async () => {
    await expect(invite({ email: 'gestor@ucb.edu.br' })).rejects.toMatchObject({
      response: { code: 'ADMIN_ALREADY_ACTIVE' },
    });
  });

  it('recusa dois convites simultâneos para o mesmo e-mail', async () => {
    await invite();
    await expect(invite()).rejects.toMatchObject({
      response: { code: 'ADMIN_INVITE_ALREADY_PENDING' },
    });
    expect(invites).toHaveLength(1);
  });

  it('registra a falha de e-mail em vez de esconder o convite sem entrega', async () => {
    mail.send.mockResolvedValue('FAILED');
    const result = await invite();
    expect(result.delivery).toBe('FAILED');
    expect(audits.map((a) => a.action)).toContain('ADMIN_INVITE_EMAIL_FAILED');
  });

  it('revoga convite pendente e recusa revogar o que já saiu de pendente', async () => {
    await invite();
    await expect(service.revoke(actor, 'invite-1')).resolves.toEqual({ revoked: true });
    await expect(service.revoke(actor, 'invite-1')).rejects.toMatchObject({
      response: { code: 'ADMIN_INVITE_NOT_PENDING' },
    });
  });

  // -------------------------------------------------------------- aceite

  it('confirma o endereço ao abrir o link e carimba a data uma vez', async () => {
    await invite();
    const token = tokenFromMail();
    const preview = await service.confirmEmail(token);
    expect(preview).toMatchObject({
      email: 'novo@ucb.edu.br',
      accountExists: false,
      permissions: [AdminPermission.MANAGE_USERS],
    });
    const first = invites[0].emailConfirmedAt;
    await service.confirmEmail(token);
    expect(invites[0].emailConfirmedAt).toBe(first);
  });

  it('recusa token inexistente, expirado e já aceito', async () => {
    await expect(service.confirmEmail('x'.repeat(43))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await invite();
    const token = tokenFromMail();
    invites[0].expiresAt = new Date(Date.now() - 1000);
    await expect(service.confirmEmail(token)).rejects.toMatchObject({
      response: { code: 'ADMIN_INVITE_INVALID' },
    });
    invites[0].expiresAt = new Date(Date.now() + 3600_000);
    invites[0].status = AdminInviteStatus.ACCEPTED;
    await expect(service.confirmEmail(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('cria a conta no passo da senha sem conceder papel nem permissão', async () => {
    await invite();
    const token = tokenFromMail();
    const result = await service.setPassword(token, {
      token,
      cpf: '52998224725',
      password: PASSWORD,
    });
    expect(result.twoFactor.secret).toBe('INVITESECRET');
    expect(result.twoFactor.qrCode).toMatch(/^data:image\/png;base64,/);
    const created = accounts.at(-1)!;
    expect(created.roles).toEqual([]);
    expect(access[created.id]).toBeUndefined();
    expect(factors[created.id]).toMatchObject({ enabled: false, recoveryCodes: [] });
  });

  it('recusa CPF inválido e CPF já usado por outra conta', async () => {
    await invite();
    const token = tokenFromMail();
    await expect(
      service.setPassword(token, { token, cpf: '11111111111', password: PASSWORD }),
    ).rejects.toBeInstanceOf(ConflictException);
    accounts.push({
      id: 'outro',
      institutionalEmail: 'outro@ucb.edu.br',
      passwordHash: 'h',
      cpf: '52998224725',
      status: UserStatus.ACTIVE,
      deletedAt: null,
      roles: [],
    });
    await expect(
      service.setPassword(token, { token, cpf: '52998224725', password: PASSWORD }),
    ).rejects.toMatchObject({ response: { code: 'CPF_IN_USE' } });
  });

  it('não troca a senha de conta já existente: exige a senha atual', async () => {
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    accounts.push({
      id: 'estudante',
      institutionalEmail: 'novo@ucb.edu.br',
      passwordHash,
      status: UserStatus.ACTIVE,
      deletedAt: null,
      roles: [],
    });
    await invite();
    const token = tokenFromMail();
    await expect(
      service.setPassword(token, { token, password: 'OutraSenha123!' }),
    ).rejects.toMatchObject({ response: { code: 'CURRENT_PASSWORD_REQUIRED' } });
    await expect(
      service.setPassword(token, { token, currentPassword: 'errada' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await service.setPassword(token, { token, currentPassword: PASSWORD });
    expect(findAccount({ id: 'estudante' })!.passwordHash).toBe(passwordHash);
  });

  it('concede papel, permissões e códigos de recuperação só na confirmação do código', async () => {
    await invite();
    const token = tokenFromMail();
    await service.setPassword(token, { token, cpf: '52998224725', password: PASSWORD });
    const created = accounts.at(-1)!;
    const result = await service.confirmTwoFactor(token, { token, code: '123456' });
    expect(result.activated).toBe(true);
    expect(result.recoveryCodes).toHaveLength(8);
    expect(factors[created.id].enabled).toBe(true);
    expect(userRoles).toEqual([{ userId: created.id, roleId: 'role-admin' }]);
    expect(access[created.id]).toEqual({
      permissions: [AdminPermission.MANAGE_USERS],
      grantedById: actor.id,
    });
    expect(invites[0].status).toBe(AdminInviteStatus.ACCEPTED);
    expect(JSON.stringify(audits)).not.toContain(result.recoveryCodes[0]);
    // Nenhum código de recuperação em claro vai para a auditoria nem sessão aberta.
    expect(revokedSessions).toBe(1);
  });

  it('guarda apenas hashes dos códigos de recuperação', async () => {
    await invite();
    const token = tokenFromMail();
    await service.setPassword(token, { token, cpf: '52998224725', password: PASSWORD });
    const created = accounts.at(-1)!;
    const { recoveryCodes } = await service.confirmTwoFactor(token, { token, code: '123456' });
    for (const [index, code] of recoveryCodes.entries())
      expect(
        await argon2.verify(factors[created.id].recoveryCodes[index], code.replace('-', '')),
      ).toBe(true);
    expect(factors[created.id].recoveryCodes).not.toContain(recoveryCodes[0]);
  });

  it('recusa confirmar o código antes da senha', async () => {
    await invite();
    const token = tokenFromMail();
    await expect(service.confirmTwoFactor(token, { token, code: '123456' })).rejects.toMatchObject({
      response: { code: 'ADMIN_INVITE_PASSWORD_PENDING' },
    });
  });

  it('recusa código inválido e código repetido, sem ativar o fator', async () => {
    await invite();
    const token = tokenFromMail();
    await service.setPassword(token, { token, cpf: '52998224725', password: PASSWORD });
    const created = accounts.at(-1)!;
    (verify as jest.Mock).mockResolvedValue({ valid: false });
    await expect(service.confirmTwoFactor(token, { token, code: '000000' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(factors[created.id].enabled).toBe(false);
    (verify as jest.Mock).mockResolvedValue({ valid: true });
    limiter.claimCode.mockResolvedValue(false);
    await expect(service.confirmTwoFactor(token, { token, code: '123456' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(factors[created.id].enabled).toBe(false);
    expect(userRoles).toEqual([]);
  });

  it('o token não serve duas vezes: depois de aceito, recusa', async () => {
    await invite();
    const token = tokenFromMail();
    await service.setPassword(token, { token, cpf: '52998224725', password: PASSWORD });
    await service.confirmTwoFactor(token, { token, code: '123456' });
    await expect(service.confirmTwoFactor(token, { token, code: '123456' })).rejects.toMatchObject({
      response: { code: 'ADMIN_INVITE_INVALID' },
    });
    expect(userRoles).toHaveLength(1);
  });

  it('convite revogado não ativa ninguém, mesmo com a senha já definida', async () => {
    await invite();
    const token = tokenFromMail();
    await service.setPassword(token, { token, cpf: '52998224725', password: PASSWORD });
    await service.revoke(actor, 'invite-1');
    await expect(service.confirmTwoFactor(token, { token, code: '123456' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(userRoles).toEqual([]);
  });
});
