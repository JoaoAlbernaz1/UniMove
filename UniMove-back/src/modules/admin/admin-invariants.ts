import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { AdminPermission, RoleName, UserStatus } from '../../generated/prisma/enums';

// Valor arbitrário e fixo: serializa as operações que podem reduzir o número de
// administradores. Sem isso, dois admins suspendendo um ao outro ao mesmo tempo
// deixariam o sistema sem nenhum acesso administrativo.
const ADMIN_INVARIANT_LOCK = 717_001;

export async function lockAdminInvariant(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_INVARIANT_LOCK}::bigint)`;
}

/** Administrador capaz de entrar no painel hoje. */
export function validAdminWhere(excludeUserId?: string): Prisma.UserWhereInput {
  return {
    ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    status: UserStatus.ACTIVE,
    deletedAt: null,
    roles: { some: { role: { name: RoleName.ADMIN } } },
    twoFactor: { is: { enabled: true } },
  };
}

/**
 * Chamar dentro da transação que vai retirar o acesso de `userId`.
 * O chamador deve adquirir lockAdminInvariant antes de suas próprias leituras de
 * status/papéis e locks de linha. Reentrar neste lock na mesma transação é seguro.
 */
export async function assertNotLastAdmin(tx: Prisma.TransactionClient, userId: string) {
  await lockAdminInvariant(tx);
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { roles: { select: { role: { select: { name: true } } } } },
  });
  if (!user?.roles.some((item) => item.role.name === RoleName.ADMIN)) return;
  // Serializable fixa o snapshot no SELECT do advisory lock, antes de uma eventual
  // espera. Bloquear os candidatos força conflito se status, papel ou MFA mudaram
  // desde esse snapshot; contar sem isso poderia considerar um admin já suspenso.
  await tx.$executeRaw`
    SELECT u.id
    FROM users AS u
    JOIN user_roles AS ur ON ur.user_id = u.id
    JOIN roles AS r ON r.id = ur.role_id
    JOIN two_factor_auth AS tfa ON tfa.user_id = u.id
    WHERE u.id <> ${userId}::uuid
      AND u.status = ${UserStatus.ACTIVE}::"UserStatus"
      AND u.deleted_at IS NULL
      AND r.name = ${RoleName.ADMIN}::"RoleName"
      AND tfa.enabled = true
    ORDER BY u.id
    FOR SHARE OF u, ur, tfa`;
  if (!(await tx.user.count({ where: validAdminWhere(userId) })))
    throw new ConflictException({
      code: 'LAST_ADMIN',
      message: 'Esta é a última conta administrativa válida. Habilite outra antes de continuar.',
    });
}

/** Administrador que pode gerenciar acessos hoje. */
export function validAdminManagerWhere(excludeUserId?: string): Prisma.UserWhereInput {
  return {
    ...validAdminWhere(excludeUserId),
    adminAccess: { is: { permissions: { has: AdminPermission.MANAGE_ADMINS } } },
  };
}

/**
 * Chamar dentro da transação que vai retirar de `userId` o papel ADMIN, o
 * segundo fator ou a permissão MANAGE_ADMINS. Sem isso, dois gestores podem
 * remover um ao outro ao mesmo tempo e ninguém mais convida administrador.
 * Vale junto de assertNotLastAdmin, não em vez dela: perder o último gestor é
 * um bloqueio diferente de perder o último administrador.
 */
export async function assertNotLastAdminManager(tx: Prisma.TransactionClient, userId: string) {
  await lockAdminInvariant(tx);
  const access = await tx.adminAccess.findUnique({
    where: { userId },
    select: { permissions: true },
  });
  if (!access?.permissions.includes(AdminPermission.MANAGE_ADMINS)) return;
  // Mesmo raciocínio de assertNotLastAdmin: bloquear os candidatos força
  // conflito se status, papel, MFA ou permissão mudaram desde o snapshot.
  await tx.$executeRaw`
    SELECT u.id
    FROM users AS u
    JOIN user_roles AS ur ON ur.user_id = u.id
    JOIN roles AS r ON r.id = ur.role_id
    JOIN two_factor_auth AS tfa ON tfa.user_id = u.id
    JOIN admin_access AS aa ON aa.user_id = u.id
    WHERE u.id <> ${userId}::uuid
      AND u.status = ${UserStatus.ACTIVE}::"UserStatus"
      AND u.deleted_at IS NULL
      AND r.name = ${RoleName.ADMIN}::"RoleName"
      AND tfa.enabled = true
      AND 'MANAGE_ADMINS' = ANY (aa.permissions)
    ORDER BY u.id
    FOR SHARE OF u, ur, tfa, aa`;
  if (!(await tx.user.count({ where: validAdminManagerWhere(userId) })))
    throw new ConflictException({
      code: 'LAST_ADMIN_MANAGER',
      message:
        'Esta é a última conta autorizada a gerenciar acessos administrativos. Autorize outra antes de continuar.',
    });
}
