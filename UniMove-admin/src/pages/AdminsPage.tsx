import { useId, useState } from "react"
import {
  ArrowLeft,
  Check,
  LogOut,
  MailPlus,
  ShieldCheck,
  UserMinus,
  UserPlus,
} from "lucide-react"
import { DataTable, ListView, type Column } from "../components/DataTable"
import { Tabs, TabPanel } from "../components/Tabs"
import { AlertBanner, ContextMenu, TextInput } from "../components/fields"
import { EMPTY_REAUTH, ReauthFields, reauthReady } from "../components/Reauth"
import {
  Avatar,
  Badge,
  Button,
  ConfirmModal,
  EmptyState,
  ErrorState,
  Loading,
  Modal,
  PageIntro,
  SearchInput,
} from "../components/ui"
import { useQuery } from "../hooks/useQuery"
import { useSearchField, useUrlFilters } from "../hooks/useUrlFilters"
import { useAdmin } from "../layout/AdminContext"
import { countOf, formatDateTime, initialsOf, shortId } from "../lib/format"
import {
  ACCOUNT_STATE_LABEL,
  ACCOUNT_STATE_TONE,
  INVITE_STATUS_LABEL,
  INVITE_STATUS_TONE,
  PERMISSION_PRESETS,
  RECOVERY_STATUS_LABEL,
  RECOVERY_STATUS_TONE,
} from "../lib/securityLabels"
import {
  adminAccountsApi,
  invitesApi,
  mfaRecoveryApi,
  permissionsApi,
} from "../services/adminIamApi"
import { asDisplayError, iamErrorMessage } from "../services/adminIamErrors"
import { describeDevice } from "../lib/userAgent"
import type {
  AdminAccountRow,
  AdminInviteRow,
  AdminPermission,
  AdminPermissionInfo,
  AdminRecoveryRow,
  MailDelivery,
  ReauthInput,
} from "../types/admin-iam"

const FILTERS = { q: null, tab: ["admins", "invites", "recoveries"] }

/** Aviso de entrega para o que não foi `SENT`: o convite existe, o link não saiu. */
function DeliveryNotice({ delivery }: { delivery: MailDelivery }) {
  if (delivery === "SENT") return null
  return (
    <AlertBanner tone="warning" title="O e-mail não foi entregue">
      {delivery === "NOT_CONFIGURED"
        ? "O servidor não tem provedor de e-mail configurado, então o link não foi enviado. O convite existe e continua válido: combine o envio com a equipe de infraestrutura."
        : "A tentativa de envio falhou. O convite existe e continua válido, mas o destinatário não recebeu o link."}
    </AlertBanner>
  )
}

export default function AdminsPage() {
  const { showToast } = useAdmin()
  const { values, page, setFilters, setPage, clearFilters } = useUrlFilters(FILTERS)
  const [query, setQuery] = useSearchField(values.q, (q) => setFilters({ q }))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const panelId = useId()

  const tab = (values.tab || "admins") as "admins" | "invites" | "recoveries"
  const catalog = useQuery(() => permissionsApi.catalog(), [])
  const admins = useQuery(
    () => adminAccountsApi.list({ page, q: values.q || undefined }),
    [page, values.q],
  )
  const invites = useQuery(() => invitesApi.list({ page: 1 }), [])
  const recoveries = useQuery(() => mfaRecoveryApi.list({ page: 1 }), [])

  const reloadAll = () => {
    void admins.reload()
    void invites.reload()
    void recoveries.reload()
  }

  if (selectedId) {
    return (
      <AdminDetail
        id={selectedId}
        catalog={catalog.data ?? []}
        onBack={() => {
          setSelectedId(null)
          reloadAll()
        }}
      />
    )
  }

  const pendingInvites = admins.data?.pendingInvites ?? 0
  const pendingRecoveries =
    recoveries.data?.items.filter((item) => item.status === "PENDING" && !item.expired)
      .length ?? 0
  const rows = admins.data?.items ?? []

  const columns: Column<AdminAccountRow>[] = [
    {
      key: "admin",
      header: "Administrador",
      primary: true,
      wrap: true,
      cell: (row) => (
        <button
          type="button"
          className="person-cell"
          onClick={() => setSelectedId(row.id)}
        >
          <Avatar initials={initialsOf(row.fullName)} />
          <span>
            <strong>{row.fullName}</strong>
            <small>{row.email}</small>
          </span>
        </button>
      ),
    },
    {
      key: "state",
      header: "Situação",
      cell: (row) => (
        <Badge tone={ACCOUNT_STATE_TONE[row.state]}>
          {ACCOUNT_STATE_LABEL[row.state]}
        </Badge>
      ),
    },
    {
      key: "mfa",
      header: "Segundo fator",
      cell: (row) => (
        <Badge tone={row.twoFactorEnabled ? "green" : "amber"}>
          {row.twoFactorEnabled ? "Ativo" : "Pendente"}
        </Badge>
      ),
    },
    {
      key: "permissions",
      header: "Permissões",
      cell: (row) =>
        row.permissions.length ? (
          countOf(row.permissions.length, "permissão", "permissões")
        ) : (
          <span className="subtle">Nenhuma</span>
        ),
    },
    {
      key: "sessions",
      header: "Sessões",
      cell: (row) => row.activeSessions,
    },
    {
      key: "actions",
      header: "Ações",
      action: true,
      cell: (row) => (
        <ContextMenu
          ariaLabel={`Ações para ${row.fullName}`}
          items={[
            {
              label: "Ver detalhes e permissões",
              onClick: () => setSelectedId(row.id),
            },
          ]}
        />
      ),
    },
  ]

  return (
    <>
      <PageIntro
        title="Administradores"
        description="Contas administrativas, convites de uso único, permissões e estado do segundo fator."
        action={
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus size={16} aria-hidden="true" /> Convidar administrador
          </Button>
        }
      />

      <div className="stat-band stat-band-security">
        <div>
          <span className="stat-label">Administradores</span>
          <strong className="stat-value numeric">{admins.data?.total ?? "—"}</strong>
        </div>
        <div>
          <span className="stat-label">Ativação pendente</span>
          <strong className="stat-value numeric">
            {admins.data ? rows.filter((row) => row.state === "PENDING_ACTIVATION").length : "—"}
          </strong>
        </div>
        <div>
          <span className="stat-label">Convites em aberto</span>
          <strong className="stat-value numeric">{admins.data ? pendingInvites : "—"}</strong>
        </div>
        <div>
          <span className="stat-label">Recuperações a revisar</span>
          <strong className="stat-value numeric">
            {recoveries.data ? pendingRecoveries : "—"}
          </strong>
        </div>
      </div>

      <Tabs
        label="Seções de administradores"
        panelId={panelId}
        value={tab}
        items={[
          { id: "admins", label: "Contas" },
          {
            id: "invites",
            label: "Convites",
            count: admins.data ? pendingInvites : undefined,
          },
          {
            id: "recoveries",
            label: "Recuperações",
            count: recoveries.data ? pendingRecoveries : undefined,
          },
        ]}
        onChange={(next) => setFilters({ tab: next === "admins" ? "" : next })}
      />
      <TabPanel panelId={panelId} active={tab}>
        {tab === "admins" && (
          <section className="panel">
            <div className="table-toolbar">
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder="Buscar administrador ou e-mail"
              />
            </div>
            <ListView
              query={admins}
              label="Contas administrativas"
              columns={columns}
              rowKey={(row) => row.id}
              empty={
                <EmptyState
                  title="Nenhum administrador encontrado"
                  filtered={Boolean(values.q)}
                  onClear={clearFilters}
                />
              }
              page={page}
              onPageChange={setPage}
              countLabel={(total) => countOf(total, "administrador", "administradores")}
            />
          </section>
        )}
        {tab === "invites" && (
          <InvitesSection
            query={invites}
            catalog={catalog.data ?? []}
            onChanged={reloadAll}
          />
        )}
        {tab === "recoveries" && (
          <RecoveriesSection query={recoveries} onChanged={reloadAll} />
        )}
      </TabPanel>

      {inviteOpen && (
        <InviteModal
          catalog={catalog.data ?? []}
          onClose={() => setInviteOpen(false)}
          onCreated={(email, delivery) => {
            setInviteOpen(false)
            reloadAll()
            setFilters({ tab: "invites" })
            showToast({
              message:
                delivery === "SENT"
                  ? `Convite enviado para ${email}.`
                  : `Convite criado para ${email}, mas o e-mail não foi entregue.`,
              type: delivery === "SENT" ? "success" : "error",
            })
          }}
        />
      )}
    </>
  )
}

// ----------------------------------------------------------------- convites

function InvitesSection({
  query,
  catalog,
  onChanged,
}: {
  query: ReturnType<typeof useQuery<Awaited<ReturnType<typeof invitesApi.list>>>>
  catalog: AdminPermissionInfo[]
  onChanged: () => void
}) {
  const { showToast } = useAdmin()
  const [target, setTarget] = useState<AdminInviteRow | null>(null)
  const labels = new Map(catalog.map((item) => [item.value, item.label]))

  if (query.loading) return <Loading label="Carregando convites..." />
  if (query.error)
    return <ErrorState error={query.error} onRetry={() => void query.reload()} />

  const items = query.data?.items ?? []
  const columns: Column<AdminInviteRow>[] = [
    {
      key: "email",
      header: "Convidado",
      primary: true,
      wrap: true,
      cell: (row) => (
        <span className="person-cell">
          <span>
            <strong>{row.fullName}</strong>
            <small>{row.email}</small>
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => (
        <Badge tone={row.expired ? "red" : INVITE_STATUS_TONE[row.status]}>
          {row.expired ? "Convite expirado" : INVITE_STATUS_LABEL[row.status]}
        </Badge>
      ),
    },
    {
      key: "permissions",
      header: "Permissões",
      wrap: true,
      cell: (row) =>
        row.permissions.length
          ? row.permissions.map((item) => labels.get(item) ?? item).join(", ")
          : "Nenhuma",
    },
    {
      key: "confirmed",
      header: "Endereço confirmado",
      cell: (row) =>
        row.emailConfirmedAt ? (
          formatDateTime(row.emailConfirmedAt)
        ) : (
          <span className="subtle">Link não aberto</span>
        ),
    },
    {
      key: "expires",
      header: "Validade",
      cell: (row) => formatDateTime(row.expiresAt),
    },
    {
      key: "actions",
      header: "Ações",
      action: true,
      cell: (row) => (
        <ContextMenu
          ariaLabel={`Ações do convite de ${row.email}`}
          items={
            row.status === "PENDING"
              ? [
                  {
                    label: "Revogar convite",
                    danger: true,
                    onClick: () => setTarget(row),
                  },
                ]
              : []
          }
        />
      ),
    },
  ]

  return (
    <>
      <section className="panel">
        {items.length === 0 ? (
          <EmptyState
            title="Nenhum convite emitido"
            description="Convites administrativos aparecem aqui com a situação e a validade."
          />
        ) : (
          <DataTable
            label="Convites administrativos"
            columns={columns}
            rows={items}
            rowKey={(row) => row.id}
            busy={query.loading}
          />
        )}
      </section>

      {target && (
        <ConfirmModal
          title="Revogar convite"
          description={`O link enviado para ${target.email} deixa de funcionar imediatamente.`}
          confirmLabel="Revogar convite"
          destructive
          onClose={() => setTarget(null)}
          onConfirm={async () => {
            try {
              await invitesApi.revoke(target.id)
              setTarget(null)
              onChanged()
              showToast({ message: "Convite revogado." })
            } catch (reason) {
              throw asDisplayError(reason)
            }
          }}
        />
      )}
    </>
  )
}

function InviteModal({
  catalog,
  onClose,
  onCreated,
}: {
  catalog: AdminPermissionInfo[]
  onClose: () => void
  onCreated: (email: string, delivery: MailDelivery) => void
}) {
  const [email, setEmail] = useState("")
  const [fullName, setFullName] = useState("")
  const [permissions, setPermissions] = useState<AdminPermission[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [created, setCreated] = useState<{
    delivery: MailDelivery
    expiresAt: string
  } | null>(null)

  const ready = email.includes("@") && fullName.trim().length >= 3 && !busy

  async function submit() {
    if (!ready) return
    setBusy(true)
    setError(undefined)
    try {
      const result = await invitesApi.create({
        email: email.trim(),
        fullName: fullName.trim(),
        permissions,
      })
      setCreated({ delivery: result.delivery, expiresAt: result.invite.expiresAt })
      setBusy(false)
    } catch (reason) {
      setError(iamErrorMessage(reason))
      setBusy(false)
    }
  }

  if (created) {
    return (
      <Modal
        title="Convite emitido"
        description="O acesso só existe depois que a pessoa define a senha e ativa o segundo fator."
        onClose={() => onCreated(email.trim(), created.delivery)}
        width="lg"
      >
        <div className="modal-body auth-form">
          {created.delivery === "SENT" ? (
            <AlertBanner tone="success" title="Link enviado">
              Um link de uso único foi enviado para <strong>{email}</strong>.
            </AlertBanner>
          ) : (
            <DeliveryNotice delivery={created.delivery} />
          )}
          <section className="verification-sheet">
            <div>
              <span>Destinatário</span>
              <strong>{email}</strong>
            </div>
            <div>
              <span>Validade do convite</span>
              <strong>{formatDateTime(created.expiresAt)}</strong>
            </div>
            <div>
              <span>Estado inicial</span>
              <strong>Convite pendente • sem acesso</strong>
            </div>
            <div>
              <span>Liberação de acesso</span>
              <strong>Após definir senha e ativar o segundo fator</strong>
            </div>
          </section>
        </div>
        <footer className="modal-footer">
          <Button onClick={() => onCreated(email.trim(), created.delivery)}>
            Voltar para a lista
          </Button>
        </footer>
      </Modal>
    )
  }

  return (
    <Modal
      title="Convidar administrador"
      description="Convite nominal, de uso único, vinculado ao endereço informado."
      onClose={onClose}
      width="lg"
      dismissible={!busy}
    >
      <div className="modal-body auth-form">
        {error && <AlertBanner tone="danger">{error}</AlertBanner>}
        <TextInput
          label="Nome completo"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          placeholder="Nome que aparecerá na auditoria"
        />
        <TextInput
          label="E-mail institucional"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="pessoa@ucb.edu.br"
          hint="O convite vale apenas para este endereço, e o domínio precisa estar autorizado."
        />

        <PermissionPicker
          catalog={catalog}
          value={permissions}
          onChange={setPermissions}
        />

        <AlertBanner tone="warning" title="Como o acesso é concedido">
          O convite não dá acesso por si. A pessoa precisa abrir o link, definir
          a senha e confirmar o segundo fator; só então o papel administrativo e
          as permissões acima passam a valer.
        </AlertBanner>
      </div>
      <footer className="modal-footer">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button onClick={() => void submit()} disabled={!ready} aria-busy={busy}>
          <MailPlus size={15} aria-hidden="true" />
          {busy ? "Enviando..." : "Enviar convite"}
        </Button>
      </footer>
    </Modal>
  )
}

/**
 * As permissões reais, com rótulo e descrição vindos da API. Os atalhos acima
 * só preenchem as caixas: o que vale é a lista marcada, que é o que o servidor
 * grava e confere.
 */
function PermissionPicker({
  catalog,
  value,
  onChange,
}: {
  catalog: AdminPermissionInfo[]
  value: AdminPermission[]
  onChange: (next: AdminPermission[]) => void
}) {
  const toggle = (permission: AdminPermission) =>
    onChange(
      value.includes(permission)
        ? value.filter((item) => item !== permission)
        : [...value, permission],
    )

  return (
    <div className="inset-section">
      <div>
        <h4>Permissões concedidas</h4>
        <p>
          A autorização é por permissão, não por cargo. Comece de um atalho se
          ajudar e ajuste as caixas: elas são o que fica gravado.
        </p>
      </div>
      <div className="preset-row">
        <span>Atalhos:</span>
        {PERMISSION_PRESETS.map((preset) => (
          <Button
            key={preset.id}
            variant="secondary"
            size="small"
            title={preset.description}
            onClick={() => onChange([...preset.permissions] as AdminPermission[])}
          >
            {preset.label}
          </Button>
        ))}
        {value.length > 0 && (
          <Button variant="ghost" size="small" onClick={() => onChange([])}>
            Limpar
          </Button>
        )}
      </div>
      {catalog.length === 0 ? (
        <p className="subtle">Carregando o catálogo de permissões...</p>
      ) : (
        <div className="permission-picker">
          {catalog.map((permission) => (
            <label
              key={permission.value}
              className="permission-option"
              data-sensitive={permission.sensitive}
            >
              <input
                type="checkbox"
                checked={value.includes(permission.value)}
                onChange={() => toggle(permission.value)}
              />
              <span>
                <strong>
                  {permission.label}
                  {permission.sensitive && <Badge tone="amber">Ação sensível</Badge>}
                </strong>
                <small>{permission.description}</small>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------ recuperações

function RecoveriesSection({
  query,
  onChanged,
}: {
  query: ReturnType<typeof useQuery<Awaited<ReturnType<typeof mfaRecoveryApi.list>>>>
  onChanged: () => void
}) {
  const { showToast } = useAdmin()
  const [target, setTarget] = useState<{
    request: AdminRecoveryRow
    approve: boolean
  } | null>(null)

  if (query.loading) return <Loading label="Carregando pedidos..." />
  if (query.error)
    return <ErrorState error={query.error} onRetry={() => void query.reload()} />

  const items = query.data?.items ?? []
  const columns: Column<AdminRecoveryRow>[] = [
    {
      key: "who",
      header: "Administrador",
      primary: true,
      wrap: true,
      cell: (row) => (
        <span className="person-cell">
          <Avatar initials={initialsOf(row.user.fullName)} />
          <span>
            <strong>{row.user.fullName}</strong>
            <small>{row.user.institutionalEmail}</small>
          </span>
        </span>
      ),
    },
    {
      key: "reason",
      header: "Motivo informado",
      wrap: true,
      cell: (row) => row.reason,
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => (
        <Badge tone={row.expired ? "red" : RECOVERY_STATUS_TONE[row.status]}>
          {row.expired ? "Expirada" : RECOVERY_STATUS_LABEL[row.status]}
        </Badge>
      ),
    },
    {
      key: "when",
      header: "Aberta em",
      cell: (row) => formatDateTime(row.createdAt),
    },
    {
      key: "actions",
      header: "Ações",
      action: true,
      cell: (row) => (
        <ContextMenu
          ariaLabel={`Revisar pedido de ${row.user.fullName}`}
          items={
            row.status === "PENDING" && !row.expired
              ? [
                  {
                    label: "Aprovar recuperação",
                    onClick: () => setTarget({ request: row, approve: true }),
                  },
                  {
                    label: "Recusar pedido",
                    danger: true,
                    onClick: () => setTarget({ request: row, approve: false }),
                  },
                ]
              : []
          }
        />
      ),
    },
  ]

  return (
    <>
      <section className="panel">
        {items.length === 0 ? (
          <EmptyState
            title="Nenhum pedido de recuperação"
            description="Pedidos de recuperação do autenticador aparecem aqui para revisão."
          />
        ) : (
          <DataTable
            label="Pedidos de recuperação de autenticador"
            columns={columns}
            rows={items}
            rowKey={(row) => row.id}
            busy={query.loading}
          />
        )}
      </section>

      {target && (
        <ReviewRecoveryModal
          request={target.request}
          approve={target.approve}
          onClose={() => setTarget(null)}
          onDone={(delivery) => {
            setTarget(null)
            onChanged()
            showToast({
              message:
                delivery === "SENT"
                  ? "Pedido revisado e o administrador foi avisado."
                  : "Pedido revisado, mas o e-mail não foi entregue.",
              type: delivery === "SENT" ? "success" : "error",
            })
          }}
        />
      )}
    </>
  )
}

function ReviewRecoveryModal({
  request,
  approve,
  onClose,
  onDone,
}: {
  request: AdminRecoveryRow
  approve: boolean
  onClose: () => void
  onDone: (delivery: MailDelivery) => void
}) {
  const [reauth, setReauth] = useState<ReauthInput>(EMPTY_REAUTH)
  return (
    <ConfirmModal
      title={approve ? "Aprovar recuperação do autenticador" : "Recusar o pedido"}
      description={
        approve
          ? `${request.user.fullName} receberá um link de uso único para cadastrar um autenticador novo.`
          : `${request.user.fullName} será avisado de que o pedido foi recusado.`
      }
      confirmLabel={approve ? "Aprovar recuperação" : "Recusar pedido"}
      destructive={!approve}
      requireReason={!approve}
      reasonLabel="Observação para quem pediu"
      confirmDisabled={!reauthReady(reauth)}
      onClose={onClose}
      onConfirm={async (note) => {
        try {
          const result = await mfaRecoveryApi.review(request.id, {
            ...reauth,
            approve,
            ...(note ? { note } : {}),
          })
          onDone(result.delivery)
        } catch (reason) {
          throw asDisplayError(reason)
        }
      }}
    >
      <AlertBanner tone={approve ? "warning" : "info"}>
        {approve
          ? "Confirme a identidade por um canal confiável antes de aprovar. Aprovar invalida o autenticador atual e encerra as sessões da conta."
          : "O autenticador atual do administrador continua valendo."}
      </AlertBanner>
      <section className="verification-sheet one-col">
        <div>
          <span>Motivo informado no pedido</span>
          <strong>{request.reason}</strong>
        </div>
      </section>
      <ReauthFields value={reauth} onChange={setReauth} />
    </ConfirmModal>
  )
}

// --------------------------------------------------------------- detalhe

function AdminDetail({
  id,
  catalog,
  onBack,
}: {
  id: string
  catalog: AdminPermissionInfo[]
  onBack: () => void
}) {
  const { showToast } = useAdmin()
  const [dialog, setDialog] = useState<"none" | "permissions" | "revoke" | "sessions">(
    "none",
  )

  const admins = useQuery(() => adminAccountsApi.list({ page: 1 }), [])
  const sessions = useQuery(() => adminAccountsApi.sessionsOf(id), [id])
  const row = admins.data?.items.find((item) => item.id === id)

  if (admins.loading) return <Loading label="Carregando administrador..." />
  if (admins.error)
    return <ErrorState error={admins.error} onRetry={() => void admins.reload()} />
  if (!row)
    return (
      <>
        <div className="subpage-back">
          <button type="button" className="text-button" onClick={onBack}>
            <ArrowLeft size={14} aria-hidden="true" /> Voltar
          </button>
        </div>
        <EmptyState
          title="Administrador não encontrado"
          description="A conta pode ter deixado de ser administradora enquanto esta tela estava aberta."
        />
      </>
    )

  const labels = new Map(catalog.map((item) => [item.value, item]))

  return (
    <>
      <div className="subpage-back">
        <button type="button" className="text-button" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" /> Administradores
        </button>
        <span aria-hidden="true">•</span>
        <span>{row.fullName}</span>
      </div>

      <PageIntro
        title={row.fullName}
        description={row.email}
        action={
          <div className="action-group">
            <Button variant="secondary" onClick={() => setDialog("permissions")}>
              <ShieldCheck size={15} aria-hidden="true" /> Alterar permissões
            </Button>
            <Button
              variant="secondary"
              disabled={row.activeSessions === 0}
              onClick={() => setDialog("sessions")}
            >
              <LogOut size={15} aria-hidden="true" /> Encerrar sessões
            </Button>
            <Button variant="danger" onClick={() => setDialog("revoke")}>
              <UserMinus size={15} aria-hidden="true" /> Encerrar acesso
            </Button>
          </div>
        }
      />

      <div className="stat-band stat-band-security admin-detail-strip">
        <div>
          <span className="stat-label">Situação</span>
          <strong className="stat-value">
            <Badge tone={ACCOUNT_STATE_TONE[row.state]}>
              {ACCOUNT_STATE_LABEL[row.state]}
            </Badge>
          </strong>
        </div>
        <div>
          <span className="stat-label">Segundo fator</span>
          <strong className="stat-value">
            <Badge tone={row.twoFactorEnabled ? "green" : "amber"}>
              {row.twoFactorEnabled ? "Ativo" : "Pendente"}
            </Badge>
          </strong>
        </div>
        <div>
          <span className="stat-label">Códigos de recuperação</span>
          <strong className="stat-value numeric">{row.recoveryCodesRemaining}</strong>
        </div>
        <div>
          <span className="stat-label">Sessões do painel</span>
          <strong className="stat-value numeric">{row.activeSessions}</strong>
        </div>
      </div>

      <div className="account-overview-grid">
        <section className="panel account-card">
          <div className="section-heading">
            <div>
              <h2>Conta administrativa</h2>
              <p>Identificação e histórico da credencial</p>
            </div>
          </div>
          <div className="account-meta-grid">
            <div>
              <span>Identificador</span>
              <strong className="mono">{shortId(row.id)}</strong>
            </div>
            <div>
              <span>Criada em</span>
              <strong>{formatDateTime(row.createdAt)}</strong>
            </div>
            <div>
              <span>Permissões atualizadas em</span>
              <strong>
                {row.permissionsUpdatedAt
                  ? formatDateTime(row.permissionsUpdatedAt)
                  : "Sem alteração registrada"}
              </strong>
            </div>
            <div>
              <span>E-mail</span>
              <strong>{row.email}</strong>
            </div>
          </div>
        </section>

        <section className="panel account-card">
          <div className="section-heading">
            <div>
              <h2>Permissões concedidas</h2>
              <p>O que esta conta pode fazer no painel</p>
            </div>
            <Button variant="ghost" onClick={() => setDialog("permissions")}>
              Alterar
            </Button>
          </div>
          {row.permissions.length === 0 ? (
            <div className="account-meta-grid">
              <AlertBanner tone="warning">
                Esta conta tem o papel administrativo, mas nenhuma permissão: ela
                acessa o painel e não consegue gerenciar acessos.
              </AlertBanner>
            </div>
          ) : (
            <ul className="scope-list in-card">
              {row.permissions.map((permission) => (
                <li key={permission}>
                  <Check size={14} aria-hidden="true" />
                  <span>
                    <strong>{labels.get(permission)?.label ?? permission}</strong>
                    <span className="subtle-inline">
                      {labels.get(permission)?.description ?? ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Sessões do painel desta conta</h2>
            <p>Dispositivos autenticados agora</p>
          </div>
        </div>
        {sessions.loading ? (
          <Loading label="Carregando sessões..." />
        ) : sessions.error ? (
          <ErrorState error={sessions.error} onRetry={() => void sessions.reload()} />
        ) : (sessions.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="Nenhuma sessão ativa"
            description="A conta não tem sessão aberta no painel neste momento."
            compact
          />
        ) : (
          <DataTable
            label="Sessões da conta"
            columns={[
              {
                key: "device",
                header: "Dispositivo",
                primary: true,
                wrap: true,
                cell: (session) => describeDevice(session.userAgent),
              },
              {
                key: "started",
                header: "Início",
                cell: (session) => formatDateTime(session.createdAt),
              },
              {
                key: "expires",
                header: "Expira em",
                cell: (session) => formatDateTime(session.expiresAt),
              },
            ]}
            rows={sessions.data?.items ?? []}
            rowKey={(session) => session.id}
          />
        )}
      </section>

      <p className="privacy-note">
        <ShieldCheck size={15} aria-hidden="true" />
        <span>
          Encerrar o acesso administrativo retira o papel, as permissões e as
          sessões do painel, e não exclui a conta da plataforma. Suspender ou
          bloquear a conta inteira é outra operação, na tela de Usuários.
        </span>
      </p>

      {dialog === "permissions" && (
        <ChangePermissionsModal
          row={row}
          catalog={catalog}
          onClose={() => setDialog("none")}
          onDone={() => {
            setDialog("none")
            void admins.reload()
            showToast({ message: "Permissões atualizadas." })
          }}
        />
      )}

      {dialog === "revoke" && (
        <RevokeAccessModal
          row={row}
          onClose={() => setDialog("none")}
          onDone={() => {
            showToast({ message: `Acesso administrativo de ${row.fullName} encerrado.` })
            onBack()
          }}
        />
      )}

      {dialog === "sessions" && (
        <RevokeSessionsModal
          row={row}
          onClose={() => setDialog("none")}
          onDone={(count) => {
            setDialog("none")
            void sessions.reload()
            void admins.reload()
            showToast({
              message:
                count === 1 ? "1 sessão encerrada." : `${count} sessões encerradas.`,
            })
          }}
        />
      )}
    </>
  )
}

function ChangePermissionsModal({
  row,
  catalog,
  onClose,
  onDone,
}: {
  row: AdminAccountRow
  catalog: AdminPermissionInfo[]
  onClose: () => void
  onDone: () => void
}) {
  const [permissions, setPermissions] = useState<AdminPermission[]>(row.permissions)
  const [reauth, setReauth] = useState<ReauthInput>(EMPTY_REAUTH)
  const losingManage =
    row.permissions.includes("MANAGE_ADMINS") && !permissions.includes("MANAGE_ADMINS")

  return (
    <ConfirmModal
      title="Alterar permissões"
      description={`Define o que ${row.fullName} pode fazer no painel.`}
      confirmLabel="Salvar permissões"
      requireReason
      reasonLabel="Motivo da alteração"
      reasonMinLength={5}
      confirmDisabled={!reauthReady(reauth)}
      onClose={onClose}
      onConfirm={async (reason) => {
        try {
          await adminAccountsApi.updatePermissions(row.id, {
            ...reauth,
            permissions,
            reason,
          })
          onDone()
        } catch (reason_) {
          throw asDisplayError(reason_)
        }
      }}
    >
      <PermissionPicker
        catalog={catalog}
        value={permissions}
        onChange={setPermissions}
      />
      {losingManage && (
        <AlertBanner tone="warning" title="Retirando a gestão de acessos">
          Esta conta deixará de convidar administradores e de aprovar
          recuperações. O servidor recusa a mudança se ela for a última conta
          autorizada a fazer isso.
        </AlertBanner>
      )}
      <ReauthFields value={reauth} onChange={setReauth} />
    </ConfirmModal>
  )
}

function RevokeAccessModal({
  row,
  onClose,
  onDone,
}: {
  row: AdminAccountRow
  onClose: () => void
  onDone: () => void
}) {
  const [reauth, setReauth] = useState<ReauthInput>(EMPTY_REAUTH)
  return (
    <ConfirmModal
      title="Encerrar acesso administrativo"
      description={`${row.fullName} perde o painel imediatamente. A conta de plataforma continua existindo.`}
      confirmLabel="Encerrar acesso"
      destructive
      requireReason
      reasonLabel="Motivo do encerramento"
      reasonMinLength={5}
      confirmDisabled={!reauthReady(reauth)}
      onClose={onClose}
      onConfirm={async (reason) => {
        try {
          await adminAccountsApi.revokeAccess(row.id, { ...reauth, reason })
          onDone()
        } catch (reason_) {
          throw asDisplayError(reason_)
        }
      }}
    >
      <AlertBanner tone="danger" title="O que esta ação faz">
        Retira o papel administrativo, apaga as permissões, encerra as sessões do
        painel e revoga convites pendentes deste e-mail. Não exclui nem suspende
        a conta de usuário da plataforma.
      </AlertBanner>
      <ReauthFields value={reauth} onChange={setReauth} />
    </ConfirmModal>
  )
}

function RevokeSessionsModal({
  row,
  onClose,
  onDone,
}: {
  row: AdminAccountRow
  onClose: () => void
  onDone: (count: number) => void
}) {
  const [reauth, setReauth] = useState<ReauthInput>(EMPTY_REAUTH)
  return (
    <ConfirmModal
      title="Encerrar as sessões desta conta"
      description={`${row.fullName} precisará entrar de novo, com senha e segundo fator.`}
      confirmLabel="Encerrar sessões"
      destructive
      confirmDisabled={!reauthReady(reauth)}
      onClose={onClose}
      onConfirm={async () => {
        try {
          const result = await adminAccountsApi.revokeSessionsOf(row.id, reauth)
          onDone(result.revoked)
        } catch (reason) {
          throw asDisplayError(reason)
        }
      }}
    >
      <ReauthFields value={reauth} onChange={setReauth} />
    </ConfirmModal>
  )
}
