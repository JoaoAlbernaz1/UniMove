import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { RoleName, UserStatus } from '../../generated/prisma/enums';

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

/** Chamar dentro da transação que vai retirar o acesso de `userId`. */
export async function assertNotLastAdmin(tx: Prisma.TransactionClient, userId: string) {
  await lockAdminInvariant(tx);
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { roles: { select: { role: { select: { name: true } } } } },
  });
  if (!user?.roles.some((item) => item.role.name === RoleName.ADMIN)) return;
  if (!(await tx.user.count({ where: validAdminWhere(userId) })))
    throw new ConflictException({
      code: 'LAST_ADMIN',
      message: 'Esta é a última conta administrativa válida. Habilite outra antes de continuar.',
    });
}
