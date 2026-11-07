import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { RoleName, SessionScope } from '../../generated/prisma/enums';
import { AdminReauthService } from './admin-reauth.service';
import type { ReauthDto } from './admin-iam.dto';

/**
 * Sessões do painel. Só o escopo ADMIN aparece aqui: a coluna `scope` separa a
 * sessão administrativa da sessão do aplicativo, que nasce com o padrão APP e
 * não é da conta deste painel gerenciar.
 *
 * Sessão aberta antes desta migração está marcada como APP e por isso não é
 * listada; ela volta a aparecer no próximo login administrativo.
 */
@Injectable()
export class AdminSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reauth: AdminReauthService,
  ) {}

  async listMine(actor: AuthUser) {
    const rows = await this.prisma.refreshSession.findMany({
      where: {
        userId: actor.id,
        scope: SessionScope.ADMIN,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, userAgent: true, createdAt: true, expiresAt: true },
      take: 100,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        userAgent: row.userAgent,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        current: row.id === actor.sid,
      })),
      total: rows.length,
    };
  }

  async revokeMine(actor: AuthUser, sessionId: string) {
    if (sessionId === actor.sid)
      throw new ConflictException({
        code: 'CANNOT_REVOKE_CURRENT_SESSION',
        message: 'Para encerrar esta sessão, use Sair.',
      });
    const { count } = await this.prisma.refreshSession.updateMany({
      where: {
        id: sessionId,
        userId: actor.id,
        scope: SessionScope.ADMIN,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    if (!count) throw new NotFoundException('Sessão não encontrada ou já encerrada.');
    await this.audit(actor.id, 'ADMIN_SESSION_REVOKED', actor.id, { sessionId });
    return { revoked: count };
  }

  async revokeOthers(actor: AuthUser) {
    const { count } = await this.prisma.refreshSession.updateMany({
      where: {
        userId: actor.id,
        scope: SessionScope.ADMIN,
        revokedAt: null,
        ...(actor.sid ? { id: { not: actor.sid } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    if (count) await this.audit(actor.id, 'ADMIN_SESSIONS_REVOKED_OTHERS', actor.id, { count });
    return { revoked: count };
  }

  /** Derruba as sessões de outro administrador. Operação sensível: reautentica. */
  async revokeAllOf(actor: AuthUser, targetUserId: string, dto: ReauthDto) {
    await this.reauth.assertReauthenticated(actor.id, dto);
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, roles: { select: { role: { select: { name: true } } } } },
    });
    if (!target) throw new NotFoundException('Administrador não encontrado.');
    if (!target.roles.some((item) => item.role.name === RoleName.ADMIN))
      throw new ConflictException({
        code: 'NOT_AN_ADMIN',
        message: 'Esta conta não tem sessão administrativa para encerrar.',
      });
    const { count } = await this.prisma.refreshSession.updateMany({
      where: { userId: targetUserId, scope: SessionScope.ADMIN, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit(actor.id, 'ADMIN_SESSIONS_REVOKED_BY_MANAGER', targetUserId, { count });
    return { revoked: count };
  }

  async listOf(targetUserId: string) {
    const rows = await this.prisma.refreshSession.findMany({
      where: {
        userId: targetUserId,
        scope: SessionScope.ADMIN,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, userAgent: true, createdAt: true, expiresAt: true },
      take: 100,
    });
    return { items: rows, total: rows.length };
  }

  private audit(
    actorUserId: string,
    action: string,
    entityId: string,
    metadata: Record<string, string | number>,
  ) {
    return this.prisma.auditLog.create({
      data: { actorUserId, action, entityType: 'RefreshSession', entityId, metadata },
    });
  }
}
