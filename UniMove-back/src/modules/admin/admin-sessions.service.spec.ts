// otplib é ESM: AdminReauthService o importa e o serviço depende dele.
jest.mock('otplib', () => ({ verify: jest.fn().mockResolvedValue({ valid: true }) }));

import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service';
import { RoleName, SessionScope } from '../../generated/prisma/enums';
import { AdminSessionsService } from './admin-sessions.service';
import type { AdminReauthService } from './admin-reauth.service';

describe('AdminSessionsService', () => {
  const actor = { id: 'admin-id', roles: [RoleName.ADMIN], mfa: true, sid: 'sessao-atual' };
  const reauthCredentials = { password: 'SenhaForte123!', twoFactorCode: '123456' };
  let sessions: { id: string; userId: string; revokedAt: Date | null; scope: SessionScope }[];
  let target: { id: string; roles: { role: { name: RoleName } }[] } | null;
  let audits: { action: string; metadata?: unknown }[];
  let lastWhere: Record<string, unknown> | undefined;

  const prisma = {
    refreshSession: {
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        lastWhere = where;
        return Promise.resolve(
          sessions
            .filter((s) => !s.revokedAt && s.scope === SessionScope.ADMIN)
            .map((s) => ({
              id: s.id,
              userAgent: 'Navegador de teste',
              createdAt: new Date(),
              expiresAt: new Date(Date.now() + 3600_000),
            })),
        );
      }),
      updateMany: jest.fn(
        ({
          where,
        }: {
          where: { id?: string | { not: string }; userId: string; scope: SessionScope };
        }) => {
          lastWhere = where;
          const matches = sessions.filter((s) => {
            if (s.revokedAt || s.scope !== where.scope || s.userId !== where.userId) return false;
            if (typeof where.id === 'string') return s.id === where.id;
            if (where.id && typeof where.id === 'object') return s.id !== where.id.not;
            return true;
          });
          matches.forEach((s) => (s.revokedAt = new Date()));
          return Promise.resolve({ count: matches.length });
        },
      ),
    },
    user: { findUnique: jest.fn(() => Promise.resolve(target)) },
    auditLog: {
      create: jest.fn(({ data }: { data: { action: string } }) => {
        audits.push(data);
        return Promise.resolve(data);
      }),
    },
  };
  const reauth = { assertReauthenticated: jest.fn().mockResolvedValue(undefined) };
  const service = new AdminSessionsService(
    prisma as unknown as PrismaService,
    reauth as unknown as AdminReauthService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    audits = [];
    lastWhere = undefined;
    sessions = [
      { id: 'sessao-atual', userId: actor.id, revokedAt: null, scope: SessionScope.ADMIN },
      { id: 'sessao-outra', userId: actor.id, revokedAt: null, scope: SessionScope.ADMIN },
      { id: 'sessao-do-app', userId: actor.id, revokedAt: null, scope: SessionScope.APP },
    ];
    target = { id: 'outro-admin', roles: [{ role: { name: RoleName.ADMIN } }] };
  });

  it('lista só sessões do painel e marca qual é a atual', async () => {
    const result = await service.listMine(actor);
    expect(lastWhere).toMatchObject({ scope: SessionScope.ADMIN, userId: actor.id });
    expect(result.items.map((item) => [item.id, item.current])).toEqual([
      ['sessao-atual', true],
      ['sessao-outra', false],
    ]);
  });

  it('recusa encerrar a sessão atual pela lista: isso é Sair', async () => {
    await expect(service.revokeMine(actor, actor.sid)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
  });

  it('encerra uma sessão escolhida e audita', async () => {
    await expect(service.revokeMine(actor, 'sessao-outra')).resolves.toEqual({ revoked: 1 });
    expect(sessions.find((s) => s.id === 'sessao-outra')!.revokedAt).not.toBeNull();
    expect(audits[0].action).toBe('ADMIN_SESSION_REVOKED');
  });

  it('não encerra sessão de outra conta nem sessão do aplicativo', async () => {
    sessions.push({
      id: 'sessao-alheia',
      userId: 'outro-admin',
      revokedAt: null,
      scope: SessionScope.ADMIN,
    });
    await expect(service.revokeMine(actor, 'sessao-alheia')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.revokeMine(actor, 'sessao-do-app')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(sessions.find((s) => s.id === 'sessao-do-app')!.revokedAt).toBeNull();
  });

  it('encerrar as outras preserva a atual e a sessão do aplicativo', async () => {
    await expect(service.revokeOthers(actor)).resolves.toEqual({ revoked: 1 });
    expect(sessions.find((s) => s.id === 'sessao-atual')!.revokedAt).toBeNull();
    expect(sessions.find((s) => s.id === 'sessao-do-app')!.revokedAt).toBeNull();
    expect(sessions.find((s) => s.id === 'sessao-outra')!.revokedAt).not.toBeNull();
    expect(audits[0].action).toBe('ADMIN_SESSIONS_REVOKED_OTHERS');
  });

  it('encerrar as outras não audita quando não havia nenhuma', async () => {
    sessions = sessions.filter((s) => s.id !== 'sessao-outra');
    await expect(service.revokeOthers(actor)).resolves.toEqual({ revoked: 0 });
    expect(audits).toHaveLength(0);
  });

  it('derrubar as sessões de outro administrador exige reautenticação', async () => {
    reauth.assertReauthenticated.mockRejectedValueOnce(new Error('reauth'));
    await expect(service.revokeAllOf(actor, 'outro-admin', reauthCredentials)).rejects.toThrow(
      'reauth',
    );
    expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
  });

  it('derruba as sessões de outro administrador e audita o alvo', async () => {
    sessions.push({
      id: 'sessao-alheia',
      userId: 'outro-admin',
      revokedAt: null,
      scope: SessionScope.ADMIN,
    });
    await expect(service.revokeAllOf(actor, 'outro-admin', reauthCredentials)).resolves.toEqual({
      revoked: 1,
    });
    expect(audits[0]).toMatchObject({
      action: 'ADMIN_SESSIONS_REVOKED_BY_MANAGER',
      entityId: 'outro-admin',
    });
  });

  it('recusa derrubar sessões de conta que não é administradora', async () => {
    target = { id: 'outro-admin', roles: [] };
    await expect(
      service.revokeAllOf(actor, 'outro-admin', reauthCredentials),
    ).rejects.toMatchObject({ response: { code: 'NOT_AN_ADMIN' } });
  });

  it('recusa alvo inexistente', async () => {
    target = null;
    await expect(service.revokeAllOf(actor, 'fantasma', reauthCredentials)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
