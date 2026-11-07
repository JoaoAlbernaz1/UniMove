import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import type { Prisma } from '../../generated/prisma/client';
import {
  AdminInviteStatus,
  AdminPermission,
  RoleName,
  SessionScope,
  UserStatus,
} from '../../generated/prisma/enums';
import { adminAccessRevokedEmail } from '../mail/admin-mail.templates';
import { MailService } from '../mail/mail.service';
import {
  assertNotLastAdmin,
  assertNotLastAdminManager,
  lockAdminInvariant,
} from './admin-invariants';
import { normalizePermissions } from './admin-permissions';
import { AdminReauthService } from './admin-reauth.service';
import type {
  AdminAccountsQueryDto,
  RevokeAdminAccessDto,
  UpdateAdminPermissionsDto,
} from './admin-iam.dto';

/** Situação derivada, não guardada: o banco já tem os fatos que a definem. */
export type AdminAccountState = 'ACTIVE' | 'PENDING_ACTIVATION' | 'SUSPENDED' | 'BLOCKED';

@Injectable()
export class AdminAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reauth: AdminReauthService,
    private readonly mail: MailService,
  ) {}

  async permissionsOf(userId: string) {
    const access = await this.prisma.adminAccess.findUnique({
      where: { userId },
      select: { permissions: true },
    });
    return access?.permissions ?? [];
  }

  async list(query: AdminAccountsQueryDto) {
    const where: Prisma.UserWhereInput = {
      roles: { some: { role: { name: RoleName.ADMIN } } },
      deletedAt: null,
      ...(query.q
        ? {
            OR: [
              { fullName: { contains: query.q, mode: 'insensitive' } },
              { institutionalEmail: { contains: query.q.toLowerCase() } },
            ],
          }
        : {}),
    };
    const [rows, total, pendingInvites] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: [{ fullName: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          fullName: true,
          institutionalEmail: true,
          status: true,
          createdAt: true,
          twoFactor: { select: { enabled: true, recoveryCodes: true } },
          adminAccess: { select: { permissions: true, updatedAt: true } },
          refreshSessions: {
            where: { scope: SessionScope.ADMIN, revokedAt: null, expiresAt: { gt: new Date() } },
            select: { id: true },
          },
        },
      }),
      this.prisma.user.count({ where }),
      this.prisma.adminInvite.count({
        where: { status: AdminInviteStatus.PENDING, expiresAt: { gt: new Date() } },
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        fullName: row.fullName,
        email: row.institutionalEmail,
        state: accountState(row.status, row.twoFactor?.enabled === true),
        twoFactorEnabled: row.twoFactor?.enabled === true,
        recoveryCodesRemaining: row.twoFactor?.recoveryCodes.length ?? 0,
        permissions: row.adminAccess?.permissions ?? [],
        permissionsUpdatedAt: row.adminAccess?.updatedAt ?? null,
        activeSessions: row.refreshSessions.length,
        createdAt: row.createdAt,
      })),
      total,
      pendingInvites,
    };
  }

  async updatePermissions(actor: AuthUser, id: string, dto: UpdateAdminPermissionsDto) {
    await this.reauth.assertReauthenticated(actor.id, dto);
    const permissions = normalizePermissions(dto.permissions);
    const losingManage = !permissions.includes(AdminPermission.MANAGE_ADMINS);

    return this.prisma.$transaction(async (tx) => {
      await lockAdminInvariant(tx);
      const target = await tx.user.findUnique({
        where: { id },
        select: {
          id: true,
          fullName: true,
          institutionalEmail: true,
          deletedAt: true,
          roles: { select: { role: { select: { name: true } } } },
          adminAccess: { select: { permissions: true } },
        },
      });
      if (!target || target.deletedAt) throw new NotFoundException('Administrador não encontrado.');
      if (!target.roles.some((item) => item.role.name === RoleName.ADMIN))
        throw new ConflictException({
          code: 'NOT_AN_ADMIN',
          message: 'Esta conta não é administradora. Use o convite para conceder acesso.',
        });
      const previous = target.adminAccess?.permissions ?? [];
      if (sameSet(previous, permissions))
        throw new ConflictException({
          code: 'PERMISSIONS_UNCHANGED',
          message: 'As permissões já estão exatamente assim. Atualize a página.',
        });
      // Só confere a invariante quando a mudança retira a gestão de acessos.
      if (losingManage) await assertNotLastAdminManager(tx, id);

      const access = await tx.adminAccess.upsert({
        where: { userId: id },
        create: { userId: id, permissions, grantedById: actor.id },
        update: { permissions, grantedById: actor.id },
        select: { permissions: true, updatedAt: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'ADMIN_PERMISSIONS_CHANGED',
          entityType: 'User',
          entityId: id,
          metadata: { reason: dto.reason, previous, permissions },
        },
      });
      return { id, permissions: access.permissions, permissionsUpdatedAt: access.updatedAt };
    });
  }

  /**
   * Encerra o acesso administrativo sem apagar a conta da plataforma: retira o
   * papel ADMIN, as permissões e as sessões do painel. Suspender ou bloquear a
   * conta inteira continua sendo `PATCH /admin/users/:id/status`, que já trata
   * caronas e reservas em aberto.
   */
  async revokeAccess(actor: AuthUser, id: string, dto: RevokeAdminAccessDto) {
    if (actor.id === id)
      throw new ConflictException({
        code: 'CANNOT_REVOKE_OWN_ACCESS',
        message: 'Você não pode encerrar o seu próprio acesso administrativo.',
      });
    await this.reauth.assertReauthenticated(actor.id, dto);

    const target = await this.prisma.$transaction(async (tx) => {
      await lockAdminInvariant(tx);
      const found = await tx.user.findUnique({
        where: { id },
        select: {
          id: true,
          fullName: true,
          institutionalEmail: true,
          deletedAt: true,
          roles: { select: { role: { select: { name: true } } } },
        },
      });
      if (!found || found.deletedAt) throw new NotFoundException('Administrador não encontrado.');
      if (!found.roles.some((item) => item.role.name === RoleName.ADMIN))
        throw new ConflictException({
          code: 'NOT_AN_ADMIN',
          message: 'Esta conta já não tem acesso administrativo.',
        });
      await assertNotLastAdmin(tx, id);
      await assertNotLastAdminManager(tx, id);

      const role = await tx.role.findUniqueOrThrow({
        where: { name: RoleName.ADMIN },
        select: { id: true },
      });
      await tx.userRole.deleteMany({ where: { userId: id, roleId: role.id } });
      await tx.adminAccess.deleteMany({ where: { userId: id } });
      // O segundo fator continua na conta: ela segue sendo usuária da plataforma
      // e o fator protege o login dela também.
      await tx.refreshSession.updateMany({
        where: { userId: id, scope: SessionScope.ADMIN, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.adminInvite.updateMany({
        where: { email: found.institutionalEmail, status: AdminInviteStatus.PENDING },
        data: { status: AdminInviteStatus.REVOKED, revokedAt: new Date(), revokedById: actor.id },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'ADMIN_ACCESS_REVOKED',
          entityType: 'User',
          entityId: id,
          metadata: { reason: dto.reason },
        },
      });
      return found;
    });

    const revoker = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { fullName: true },
    });
    const delivery = await this.mail.send(
      adminAccessRevokedEmail({
        to: target.institutionalEmail,
        fullName: target.fullName,
        revokedBy: revoker?.fullName ?? 'a equipe do UniMove',
      }),
    );
    return { revoked: true, delivery };
  }
}

export function accountState(status: UserStatus, twoFactorEnabled: boolean): AdminAccountState {
  if (status === UserStatus.SUSPENDED) return 'SUSPENDED';
  if (status === UserStatus.BLOCKED || status === UserStatus.DEACTIVATED) return 'BLOCKED';
  // Papel ADMIN sem segundo fator não entra no painel: ainda está por ativar.
  return twoFactorEnabled ? 'ACTIVE' : 'PENDING_ACTIVATION';
}

function sameSet(left: AdminPermission[], right: AdminPermission[]) {
  return left.length === right.length && left.every((item) => right.includes(item));
}
