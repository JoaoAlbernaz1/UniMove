import { AdminPermission } from '../../generated/prisma/enums';

export const ADMIN_PERMISSIONS = [
  AdminPermission.MANAGE_ADMINS,
  AdminPermission.MANAGE_USERS,
  AdminPermission.REVIEW_VERIFICATIONS,
  AdminPermission.MODERATE_INCIDENTS,
  AdminPermission.VIEW_REPORTS,
  AdminPermission.VIEW_AUDIT,
] as const;

/**
 * Catálogo servido ao painel em `GET /admin/permissions`, para a interface não
 * repetir rótulo nem descrição. `sensitive` marca o que concede poder sobre
 * outros administradores: a tela deve destacar.
 */
export const ADMIN_PERMISSION_CATALOG: {
  value: AdminPermission;
  label: string;
  description: string;
  sensitive: boolean;
}[] = [
  {
    value: AdminPermission.MANAGE_ADMINS,
    label: 'Gerenciar administradores',
    description:
      'Convidar, revogar acesso, alterar permissões e aprovar recuperação de segundo fator.',
    sensitive: true,
  },
  {
    value: AdminPermission.MANAGE_USERS,
    label: 'Gerenciar usuários',
    description: 'Suspender, bloquear e reativar contas de estudantes.',
    sensitive: false,
  },
  {
    value: AdminPermission.REVIEW_VERIFICATIONS,
    label: 'Revisar validação cadastral',
    description: 'Aprovar ou recusar a verificação acadêmica dos estudantes.',
    sensitive: false,
  },
  {
    value: AdminPermission.MODERATE_INCIDENTS,
    label: 'Moderar ocorrências',
    description: 'Analisar e encerrar denúncias e incidentes relatados.',
    sensitive: false,
  },
  {
    value: AdminPermission.VIEW_REPORTS,
    label: 'Ver relatórios',
    description: 'Consultar indicadores e exportar relatórios operacionais.',
    sensitive: false,
  },
  {
    value: AdminPermission.VIEW_AUDIT,
    label: 'Ver auditoria',
    description: 'Consultar o histórico de operações administrativas.',
    sensitive: false,
  },
];

export function isAdminPermission(value: unknown): value is AdminPermission {
  return typeof value === 'string' && (ADMIN_PERMISSIONS as readonly string[]).includes(value);
}

/** Ordem do catálogo e sem repetição: a lista gravada fica estável e comparável. */
export function normalizePermissions(values: AdminPermission[]): AdminPermission[] {
  const chosen = new Set(values);
  return ADMIN_PERMISSIONS.filter((permission) => chosen.has(permission));
}
