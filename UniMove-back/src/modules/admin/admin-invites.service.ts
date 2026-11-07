import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import {
  AdminInviteStatus,
  AdminPermission,
  RoleName,
  SessionScope,
  UserStatus,
} from '../../generated/prisma/enums';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { isValidCpf } from '../../common/validators/cpf';
import { AuthAttemptLimiter } from '../auth/auth-attempt-limiter';
import { adminInviteEmail } from '../mail/admin-mail.templates';
import { MailService } from '../mail/mail.service';
import { lockAdminInvariant } from './admin-invariants';
import { normalizePermissions } from './admin-permissions';
import { buildPanelUrl, hashToken, issueToken } from './admin-tokens';
import {
  AcceptInvitePasswordDto,
  AcceptInviteTwoFactorDto,
  AdminInvitesQueryDto,
  CreateAdminInviteDto,
} from './admin-iam.dto';
import { buildRecoveryCodes, matchesTotp, provisionFactor } from './admin-two-factor';
import { decryptTwoFactorSecret } from '../auth/two-factor-crypto';

const INVALID_INVITE = {
  code: 'ADMIN_INVITE_INVALID',
  message: 'Convite inválido, expirado ou já utilizado. Solicite um novo convite.',
};

type InviteRow = {
  id: string;
  email: string;
  fullName: string;
  permissions: AdminPermission[];
  status: AdminInviteStatus;
  userId: string | null;
  expiresAt: Date;
  emailConfirmedAt: Date | null;
};

/**
 * Ciclo de vida do convite administrativo. O acesso só nasce no último passo:
 * até confirmar o segundo fator, a conta existe sem papel ADMIN e sem permissão
 * alguma. O token é de uso único, expira e vive no banco apenas como hash.
 */
@Injectable()
export class AdminInvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly limiter: AuthAttemptLimiter,
  ) {}

  // ---------------------------------------------------------------- gestão

  async list(query: AdminInvitesQueryDto) {
    const where: Prisma.AdminInviteWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { email: { contains: query.q.toLowerCase() } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.adminInvite.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          email: true,
          fullName: true,
          permissions: true,
          status: true,
          expiresAt: true,
          emailConfirmedAt: true,
          acceptedAt: true,
          revokedAt: true,
          createdAt: true,
          invitedBy: { select: { id: true, fullName: true } },
          revokedBy: { select: { id: true, fullName: true } },
          account: { select: { id: true } },
        },
      }),
      this.prisma.adminInvite.count({ where }),
    ]);
    const now = new Date();
    return {
      items: items.map(({ account, ...invite }) => ({
        ...invite,
        userId: account?.id ?? null,
        // Convite PENDING com prazo vencido não vira REVOKED no banco: o estado
        // é derivado, para a lista não depender de rotina de limpeza.
        expired: invite.status === AdminInviteStatus.PENDING && invite.expiresAt <= now,
      })),
      total,
    };
  }

  async create(actor: AuthUser, dto: CreateAdminInviteDto) {
    const email = dto.email.trim().toLowerCase();
    const domain = email.split('@')[1] ?? '';
    if (!this.allowedDomains().includes(domain))
      throw new BadRequestException({
        code: 'ADMIN_INVITE_DOMAIN_REJECTED',
        message: 'O convite administrativo exige um e-mail de domínio institucional autorizado.',
      });
    const permissions = normalizePermissions(dto.permissions);
    const ttlHours = this.config.get<number>('admin.inviteTtlHours') ?? 72;
    const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);
    const { token, tokenHash } = issueToken();

    const invite = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { institutionalEmail: email },
        select: {
          id: true,
          status: true,
          deletedAt: true,
          roles: { select: { role: { select: { name: true } } } },
          twoFactor: { select: { enabled: true } },
        },
      });
      if (existing?.deletedAt || existing?.status === UserStatus.DEACTIVATED)
        throw new ConflictException({
          code: 'ACCOUNT_DEACTIVATED',
          message: 'Esta conta foi excluída da plataforma e não pode ser convidada.',
        });
      const isAdmin = existing?.roles.some((item) => item.role.name === RoleName.ADMIN);
      if (isAdmin && existing?.twoFactor?.enabled)
        throw new ConflictException({
          code: 'ADMIN_ALREADY_ACTIVE',
          message: 'Esta conta já é administradora. Ajuste as permissões em vez de convidar.',
        });
      try {
        return await tx.adminInvite.create({
          data: {
            email,
            fullName: dto.fullName.trim(),
            tokenHash,
            permissions,
            invitedById: actor.id,
            userId: existing?.id ?? null,
            expiresAt,
          },
          select: { id: true, email: true, fullName: true, expiresAt: true, permissions: true },
        });
      } catch (error) {
        // Índice parcial admin_invites_email_pending_key: já há convite em aberto.
        if (isUniqueViolation(error))
          throw new ConflictException({
            code: 'ADMIN_INVITE_ALREADY_PENDING',
            message:
              'Já existe um convite em aberto para este e-mail. Revogue-o antes de emitir outro.',
          });
        throw error;
      }
    });

    const inviter = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { fullName: true },
    });
    const delivery = await this.mail.send(
      adminInviteEmail({
        to: invite.email,
        fullName: invite.fullName,
        invitedBy: inviter?.fullName ?? 'a equipe do UniMove',
        url: buildPanelUrl(this.panelUrl(), 'convite', token),
        expiresAt: invite.expiresAt,
        permissions: invite.permissions,
      }),
    );
    await this.audit(actor.id, 'ADMIN_INVITE_CREATED', invite.id, {
      email: invite.email,
      permissions: invite.permissions,
      expiresAt: invite.expiresAt.toISOString(),
      delivery,
    });
    if (delivery !== 'SENT')
      await this.audit(actor.id, 'ADMIN_INVITE_EMAIL_FAILED', invite.id, {
        email: invite.email,
        delivery,
      });
    return { invite: { ...invite, status: AdminInviteStatus.PENDING }, delivery };
  }

  async revoke(actor: AuthUser, id: string) {
    const { count } = await this.prisma.adminInvite.updateMany({
      where: { id, status: AdminInviteStatus.PENDING },
      data: {
        status: AdminInviteStatus.REVOKED,
        revokedAt: new Date(),
        revokedById: actor.id,
      },
    });
    if (!count) {
      const exists = await this.prisma.adminInvite.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!exists) throw new NotFoundException('Convite não encontrado.');
      throw new ConflictException({
        code: 'ADMIN_INVITE_NOT_PENDING',
        message: 'Este convite já foi aceito ou revogado. Atualize a página.',
      });
    }
    await this.audit(actor.id, 'ADMIN_INVITE_REVOKED', id);
    return { revoked: true };
  }

  // --------------------------------------------------------------- aceite

  /** Passo 4: abrir o link prova controle do endereço e carimba a confirmação. */
  async confirmEmail(token: string) {
    const tokenHash = await this.readToken(token);
    const invite = await this.prisma.$transaction(async (tx) => {
      const current = await this.loadPending(tx, tokenHash);
      if (!current.emailConfirmedAt)
        await tx.adminInvite.update({
          where: { id: current.id },
          data: { emailConfirmedAt: new Date() },
        });
      return current;
    });
    const accountExists = await this.prisma.user.findUnique({
      where: { institutionalEmail: invite.email },
      select: { id: true },
    });
    await this.audit(invite.userId, 'ADMIN_INVITE_EMAIL_CONFIRMED', invite.id, {
      email: invite.email,
    });
    return {
      email: invite.email,
      fullName: invite.fullName,
      permissions: invite.permissions,
      expiresAt: invite.expiresAt,
      /** Conta já existente: o aceite pede a senha atual, não define uma nova. */
      accountExists: Boolean(accountExists),
    };
  }

  /** Passo 5 e 6: senha definida (ou confirmada) e autenticador provisionado. */
  async setPassword(token: string, dto: AcceptInvitePasswordDto) {
    const tokenHash = await this.readToken(token);
    const result = await this.prisma.$transaction(async (tx) => {
      const invite = await this.loadPending(tx, tokenHash);
      const existing = await tx.user.findUnique({
        where: { institutionalEmail: invite.email },
        select: { id: true, passwordHash: true, status: true, deletedAt: true },
      });

      let userId: string;
      if (existing) {
        // Conta de plataforma já existente nunca tem a senha trocada pelo
        // convite: quem aceita prova que já era o dono dela.
        if (existing.deletedAt || existing.status !== UserStatus.ACTIVE)
          throw new ConflictException({
            code: 'ACCOUNT_UNAVAILABLE',
            message: 'A conta deste e-mail não está ativa. Procure a equipe responsável.',
          });
        if (!dto.currentPassword)
          throw new BadRequestException({
            code: 'CURRENT_PASSWORD_REQUIRED',
            message: 'Já existe uma conta com este e-mail. Confirme a senha atual para continuar.',
          });
        const limitKey = `invite-password:${existing.id}`;
        await this.limiter.assertAllowed(limitKey);
        if (!(await argon2.verify(existing.passwordHash, dto.currentPassword))) {
          await this.limiter.recordFailure(limitKey);
          throw new UnauthorizedException({
            code: 'INVALID_CREDENTIALS',
            message: 'Senha atual incorreta.',
          });
        }
        await this.limiter.reset(limitKey);
        userId = existing.id;
      } else {
        if (!dto.password || !dto.cpf)
          throw new BadRequestException({
            code: 'ACCOUNT_DATA_REQUIRED',
            message: 'Informe CPF e senha para criar a conta administrativa.',
          });
        const cpf = dto.cpf.replace(/\D/g, '');
        if (!isValidCpf(cpf)) throw new ConflictException('CPF inválido.');
        if (await tx.user.findUnique({ where: { cpf }, select: { id: true } }))
          throw new ConflictException({
            code: 'CPF_IN_USE',
            message: 'Este CPF já pertence a outra conta da plataforma.',
          });
        const created = await tx.user.create({
          data: {
            fullName: invite.fullName,
            cpf,
            institutionalEmail: invite.email,
            passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }),
            status: UserStatus.ACTIVE,
          },
          select: { id: true },
        });
        userId = created.id;
      }

      // Autenticador provisionado desabilitado: só o passo 7 o liga, e só então
      // o papel ADMIN é concedido.
      const factor = await provisionFactor(invite.email);
      await tx.twoFactorAuth.upsert({
        where: { userId },
        create: { userId, secret: factor.encryptedSecret, enabled: false },
        update: { secret: factor.encryptedSecret, enabled: false, recoveryCodes: [] },
      });
      await tx.adminInvite.update({
        where: { id: invite.id },
        data: { userId, emailConfirmedAt: invite.emailConfirmedAt ?? new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'ADMIN_INVITE_PASSWORD_SET',
          entityType: 'AdminInvite',
          entityId: invite.id,
          metadata: { accountCreated: !existing },
        },
      });
      return {
        userId,
        secret: factor.secret,
        otpauthUri: factor.otpauthUri,
        qrCode: factor.qrCode,
      };
    });
    return {
      twoFactor: {
        secret: result.secret,
        otpauthUri: result.otpauthUri,
        qrCode: result.qrCode,
        issuer: 'UniCarona Admin',
      },
    };
  }

  /** Passos 7 a 10: código confirmado, acesso concedido, códigos entregues. */
  async confirmTwoFactor(token: string, dto: AcceptInviteTwoFactorDto) {
    const tokenHash = await this.readToken(token);
    const { recoveryCodes, userId, inviteId } = await this.prisma.$transaction(
      async (tx) => {
        const invite = await this.loadPending(tx, tokenHash);
        if (!invite.userId)
          throw new ConflictException({
            code: 'ADMIN_INVITE_PASSWORD_PENDING',
            message: 'Defina a senha antes de confirmar o autenticador.',
          });
        const userId = invite.userId;
        const limitKey = `invite-2fa:${userId}`;
        await this.limiter.assertAllowed(limitKey);
        const factor = await tx.twoFactorAuth.findUnique({
          where: { userId },
          select: { secret: true, enabled: true },
        });
        if (!factor || factor.enabled)
          throw new ConflictException({
            code: 'ADMIN_INVITE_FACTOR_MISSING',
            message: 'Reinicie o cadastro do autenticador para continuar.',
          });
        const { secret } = decryptTwoFactorSecret(factor.secret);
        const code = dto.code.trim();
        if (!(await matchesTotp(secret, code)) || !(await this.limiter.claimCode(userId, code))) {
          await this.limiter.recordFailure(limitKey);
          await tx.auditLog.create({
            data: {
              actorUserId: userId,
              action: 'ADMIN_2FA_FAILED',
              entityType: 'AdminInvite',
              entityId: invite.id,
            },
          });
          throw new UnauthorizedException({
            code: 'INVALID_CODE',
            message: 'Código de autenticação inválido.',
          });
        }

        const { codes, hashes } = await buildRecoveryCodes();
        // enabled: false na condição fecha a corrida de duas confirmações.
        const enabled = await tx.twoFactorAuth.updateMany({
          where: { userId, enabled: false, secret: factor.secret },
          data: { enabled: true, recoveryCodes: hashes },
        });
        if (!enabled.count)
          throw new ConflictException({
            code: 'ADMIN_INVITE_FACTOR_CHANGED',
            message: 'O cadastro do autenticador mudou. Reinicie o processo.',
          });

        // Uso único: só a primeira transação encontra o convite PENDING.
        const accepted = await tx.adminInvite.updateMany({
          where: { id: invite.id, status: AdminInviteStatus.PENDING },
          data: { status: AdminInviteStatus.ACCEPTED, acceptedAt: new Date() },
        });
        if (!accepted.count) throw new UnauthorizedException(INVALID_INVITE);

        await lockAdminInvariant(tx);
        const role = await tx.role.findUnique({
          where: { name: RoleName.ADMIN },
          select: { id: true },
        });
        if (!role)
          throw new ConflictException({
            code: 'ADMIN_ROLE_MISSING',
            message: 'O papel ADMIN não está cadastrado no banco. Execute o seed de papéis.',
          });
        await tx.userRole.upsert({
          where: { userId_roleId: { userId, roleId: role.id } },
          create: { userId, roleId: role.id },
          update: {},
        });
        await tx.adminAccess.upsert({
          where: { userId },
          create: {
            userId,
            permissions: invite.permissions,
            grantedById: await this.inviterOf(tx, invite.id),
          },
          update: { permissions: invite.permissions },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: 'ADMIN_INVITE_ACCEPTED',
            entityType: 'AdminInvite',
            entityId: invite.id,
            metadata: { permissions: invite.permissions },
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: 'ADMIN_2FA_ENROLLED',
            entityType: 'User',
            entityId: userId,
            metadata: { channel: 'invite' },
          },
        });
        await this.limiter.reset(limitKey);
        return { recoveryCodes: codes, userId, inviteId: invite.id };
      },
      { timeout: 30000, maxWait: 10000 },
    );
    // Nada de sessão aberta aqui: quem ativou entra pelo login normal, com senha
    // e segundo fator, e aí sim recebe os cookies da sessão administrativa.
    await this.prisma.refreshSession.updateMany({
      where: { userId, scope: SessionScope.ADMIN, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { activated: true, inviteId, recoveryCodes };
  }

  // -------------------------------------------------------------- privados

  private allowedDomains() {
    const specific = this.config.get<string[]>('admin.inviteEmailDomains');
    if (specific?.length) return specific;
    return this.config.get<string[]>('auth.institutionalDomains') ?? [];
  }

  private panelUrl() {
    const url = this.config.get<string>('admin.panelUrl');
    if (!url)
      throw new ConflictException({
        code: 'ADMIN_PANEL_URL_MISSING',
        message: 'Configure ADMIN_PANEL_URL para que o convite possa apontar para o painel.',
      });
    return url;
  }

  /** Rate limit por token antes de qualquer consulta: freia varredura. */
  private async readToken(token: string) {
    const value = token?.trim();
    if (!value || value.length < 20 || value.length > 200)
      throw new UnauthorizedException(INVALID_INVITE);
    const tokenHash = hashToken(value);
    const limitKey = `invite-token:${tokenHash.slice(0, 32)}`;
    await this.limiter.assertAllowed(limitKey);
    return tokenHash;
  }

  private async loadPending(tx: Prisma.TransactionClient, tokenHash: string): Promise<InviteRow> {
    // FOR UPDATE serializa os passos do aceite para este convite.
    await tx.$queryRaw`SELECT id FROM admin_invites WHERE token_hash = ${tokenHash} FOR UPDATE`;
    const invite = await tx.adminInvite.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        email: true,
        fullName: true,
        permissions: true,
        status: true,
        userId: true,
        expiresAt: true,
        emailConfirmedAt: true,
      },
    });
    if (!invite || invite.status !== AdminInviteStatus.PENDING || invite.expiresAt <= new Date()) {
      await this.limiter.recordFailure(`invite-token:${tokenHash.slice(0, 32)}`);
      throw new UnauthorizedException(INVALID_INVITE);
    }
    return invite;
  }

  private async inviterOf(tx: Prisma.TransactionClient, inviteId: string) {
    const invite = await tx.adminInvite.findUnique({
      where: { id: inviteId },
      select: { invitedById: true },
    });
    return invite?.invitedById ?? null;
  }

  private audit(
    actorUserId: string | null,
    action: string,
    entityId: string,
    metadata?: Prisma.InputJsonObject,
  ) {
    return this.prisma.auditLog.create({
      data: {
        actorUserId,
        action,
        entityType: 'AdminInvite',
        entityId,
        ...(metadata ? { metadata } : {}),
      },
    });
  }
}

export function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
