// otplib é ESM: o serviço reautentica via AdminReauthService, que o importa.
jest.mock('otplib', () => ({ verify: jest.fn().mockResolvedValue({ valid: true }) }));

import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service';
import { AdminPermission, RoleName, UserStatus } from '../../generated/prisma/enums';
import type { MailService } from '../mail/mail.service';
import { AdminAccountsService, accountState } from './admin-accounts.service';
import type { AdminReauthService } from './admin-reauth.service';

const actor = { id: 'manager-id', roles: [RoleName.ADMIN], mfa: true };
const reauthCredentials = { password: 'SenhaForte123!', twoFactorCode: '123456' };

describe('AdminAccountsService', () => {
  let target: {
    id: string;
    fullName: string;
    institutionalEmail: string;
    deletedAt: Date | null;
    roles: { role: { name: RoleName } }[];
    adminAccess?: { permissions: AdminPermission[] } | null;
  } | null;
  /** Quantos outros gestores válidos existem, do ponto de vista da invariante. */
  let otherManagers: number;
  let otherAdmins: number;
  let audits: { action: string; metadata?: unknown }[];
  let storedPermissions: AdminPermission[] | undefined;
  let deletedRoles: number;
  let revokedSessions: number;

  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    user: {
      findUnique: jest.fn(() => Promise.resolve(target)),
      count: jest.fn(({ where }: { where: { adminAccess?: unknown } }) =>
        Promise.resolve(where.adminAccess ? otherManagers : otherAdmins),
      ),
    },
    adminAccess: {
      findUnique: jest.fn(() => Promise.resolve(target?.adminAccess ?? null)),
      upsert: jest.fn(({ create }: { create: { permissions: AdminPermission[] } }) => {
        storedPermissions = create.permissions;
        return Promise.resolve({ permissions: create.permissions, updatedAt: new Date() });
      }),
      deleteMany: jest.fn(() => Promise.resolve({ count: 1 })),
    },
    role: { findUniqueOrThrow: jest.fn(() => Promise.resolve({ id: 'role-admin' })) },
    userRole: {
      deleteMany: jest.fn(() => {
        deletedRoles += 1;
        return Promise.resolve({ count: 1 });
      }),
    },
    refreshSession: {
      updateMany: jest.fn(() => {
        revokedSessions += 1;
        return Promise.resolve({ count: 2 });
      }),
    },
    adminInvite: { updateMany: jest.fn(() => Promise.resolve({ count: 0 })) },
    auditLog: {
      create: jest.fn(({ data }: { data: { action: string } }) => {
        audits.push(data);
        return Promise.resolve(data);
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn((callback: (c: typeof tx) => unknown) => callback(tx)),
    adminAccess: tx.adminAccess,
    user: { findUnique: jest.fn(() => Promise.resolve({ fullName: 'Gestor' })) },
  };
  const reauth = { assertReauthenticated: jest.fn().mockResolvedValue(undefined) };
  const mail = { send: jest.fn().mockResolvedValue('SENT') };
  const service = new AdminAccountsService(
    prisma as unknown as PrismaService,
    reauth as unknown as AdminReauthService,
    mail as unknown as MailService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    audits = [];
    storedPermissions = undefined;
    deletedRoles = 0;
    revokedSessions = 0;
    otherManagers = 1;
    otherAdmins = 1;
    target = {
      id: 'target-id',
      fullName: 'Pessoa Alvo',
      institutionalEmail: 'alvo@ucb.edu.br',
      deletedAt: null,
      roles: [{ role: { name: RoleName.ADMIN } }],
      adminAccess: { permissions: [AdminPermission.MANAGE_ADMINS, AdminPermission.VIEW_AUDIT] },
    };
  });

  // --------------------------------------------------------- permissões

  it('exige reautenticação antes de alterar permissões', async () => {
    reauth.assertReauthenticated.mockRejectedValueOnce(new Error('reauth'));
    await expect(
      service.updatePermissions(actor, 'target-id', {
        ...reauthCredentials,
        permissions: [AdminPermission.VIEW_AUDIT],
        reason: 'Motivo suficiente',
      }),
    ).rejects.toThrow('reauth');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('grava as permissões na ordem do catálogo e audita o antes e o depois', async () => {
    const result = await service.updatePermissions(actor, 'target-id', {
      ...reauthCredentials,
      permissions: [AdminPermission.VIEW_AUDIT, AdminPermission.MANAGE_USERS],
      reason: 'Passa a cuidar de usuários',
    });
    expect(result.permissions).toEqual([AdminPermission.MANAGE_USERS, AdminPermission.VIEW_AUDIT]);
    expect(storedPermissions).toEqual([AdminPermission.MANAGE_USERS, AdminPermission.VIEW_AUDIT]);
    expect(audits[0]).toMatchObject({
      action: 'ADMIN_PERMISSIONS_CHANGED',
      metadata: {
        previous: [AdminPermission.MANAGE_ADMINS, AdminPermission.VIEW_AUDIT],
        permissions: [AdminPermission.MANAGE_USERS, AdminPermission.VIEW_AUDIT],
      },
    });
  });

  it('recusa conceder permissão a quem não é administrador', async () => {
    target!.roles = [];
    await expect(
      service.updatePermissions(actor, 'target-id', {
        ...reauthCredentials,
        permissions: [AdminPermission.MANAGE_ADMINS],
        reason: 'Tentativa de escalonamento',
      }),
    ).rejects.toMatchObject({ response: { code: 'NOT_AN_ADMIN' } });
    expect(storedPermissions).toBeUndefined();
  });

  it('recusa quando o conjunto de permissões não mudou', async () => {
    await expect(
      service.updatePermissions(actor, 'target-id', {
        ...reauthCredentials,
        permissions: [AdminPermission.VIEW_AUDIT, AdminPermission.MANAGE_ADMINS],
        reason: 'Sem mudança real',
      }),
    ).rejects.toMatchObject({ response: { code: 'PERMISSIONS_UNCHANGED' } });
  });

  it('impede retirar a gestão de acessos do último gestor', async () => {
    otherManagers = 0;
    await expect(
      service.updatePermissions(actor, 'target-id', {
        ...reauthCredentials,
        permissions: [AdminPermission.VIEW_AUDIT],
        reason: 'Retirar a gestão',
      }),
    ).rejects.toMatchObject({ response: { code: 'LAST_ADMIN_MANAGER' } });
    expect(storedPermissions).toBeUndefined();
  });

  it('não consulta a invariante quando a gestão de acessos é mantida', async () => {
    await service.updatePermissions(actor, 'target-id', {
      ...reauthCredentials,
      permissions: [AdminPermission.MANAGE_ADMINS, AdminPermission.VIEW_REPORTS],
      reason: 'Ganha relatórios',
    });
    expect(tx.user.count).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------ revogação

  it('recusa encerrar o próprio acesso, antes de qualquer escrita', async () => {
    await expect(
      service.revokeAccess(actor, actor.id, { ...reauthCredentials, reason: 'Saindo' }),
    ).rejects.toMatchObject({ response: { code: 'CANNOT_REVOKE_OWN_ACCESS' } });
    expect(reauth.assertReauthenticated).not.toHaveBeenCalled();
  });

  it('retira papel, permissões e sessões do painel, e avisa por e-mail', async () => {
    const result = await service.revokeAccess(actor, 'target-id', {
      ...reauthCredentials,
      reason: 'Saiu da equipe',
    });
    expect(result).toEqual({ revoked: true, delivery: 'SENT' });
    expect(deletedRoles).toBe(1);
    expect(tx.adminAccess.deleteMany).toHaveBeenCalled();
    expect(revokedSessions).toBe(1);
    expect(audits.map((a) => a.action)).toContain('ADMIN_ACCESS_REVOKED');
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('impede remover o último administrador válido', async () => {
    otherAdmins = 0;
    await expect(
      service.revokeAccess(actor, 'target-id', { ...reauthCredentials, reason: 'Último' }),
    ).rejects.toMatchObject({ response: { code: 'LAST_ADMIN' } });
    expect(deletedRoles).toBe(0);
  });

  it('impede remover o último gestor de acessos mesmo havendo outros administradores', async () => {
    otherAdmins = 3;
    otherManagers = 0;
    await expect(
      service.revokeAccess(actor, 'target-id', { ...reauthCredentials, reason: 'Último gestor' }),
    ).rejects.toMatchObject({ response: { code: 'LAST_ADMIN_MANAGER' } });
    expect(deletedRoles).toBe(0);
  });

  it('recusa revogar conta que já não é administradora', async () => {
    target!.roles = [];
    await expect(
      service.revokeAccess(actor, 'target-id', { ...reauthCredentials, reason: 'Já saiu' }),
    ).rejects.toMatchObject({ response: { code: 'NOT_AN_ADMIN' } });
  });

  it('recusa alvo inexistente ou excluído', async () => {
    target = null;
    await expect(
      service.revokeAccess(actor, 'target-id', { ...reauthCredentials, reason: 'Fantasma' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('permissionsOf devolve lista vazia quando não há linha de acesso', async () => {
    tx.adminAccess.findUnique.mockResolvedValueOnce(null);
    await expect(service.permissionsOf('qualquer')).resolves.toEqual([]);
  });
});

describe('accountState', () => {
  it('separa ativo, pendente de ativação, suspenso e bloqueado', () => {
    expect(accountState(UserStatus.ACTIVE, true)).toBe('ACTIVE');
    expect(accountState(UserStatus.ACTIVE, false)).toBe('PENDING_ACTIVATION');
    expect(accountState(UserStatus.SUSPENDED, true)).toBe('SUSPENDED');
    expect(accountState(UserStatus.BLOCKED, true)).toBe('BLOCKED');
    expect(accountState(UserStatus.DEACTIVATED, true)).toBe('BLOCKED');
  });
});

describe('ConflictException de invariante', () => {
  it('é o tipo usado nos bloqueios de último administrador', () => {
    expect(new ConflictException({ code: 'LAST_ADMIN' })).toBeInstanceOf(ConflictException);
  });
});
