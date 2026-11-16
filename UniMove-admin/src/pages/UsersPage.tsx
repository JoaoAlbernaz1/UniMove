import { useState } from "react"
import { ChevronRight, LockKeyhole, Star } from "lucide-react"
import { useAuth } from "../auth/AuthContext"
import { ListView, type Column } from "../components/DataTable"
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
  Select,
} from "../components/ui"
import { useQuery } from "../hooks/useQuery"
import { useSearchField, useUrlFilters } from "../hooks/useUrlFilters"
import { useAdmin } from "../layout/AdminContext"
import {
  countOf,
  formatDate,
  formatDateTime,
  initialsOf,
  shortId,
} from "../lib/format"
import {
  auditActionLabel,
  roleLabel,
  userStatusLabel,
  verificationLabel,
} from "../lib/labels"
import { usersApi } from "../services/adminApi"
import { ApiError } from "../services/http"
import type {
  AdminUserDetail,
  AdminUserRow,
  RoleName,
  UserImpact,
  UserStatus,
  VerificationStatus,
} from "../types/api"

/** Quem aparece como quê: administrador não é estudante, motorista vem antes de passageiro. */
function primaryRole(roles: RoleName[]) {
  if (roles.includes("ADMIN")) return roleLabel.ADMIN
  if (roles.includes("DRIVER")) return roleLabel.DRIVER
  return roleLabel.PASSENGER
}

const verificationText = (status: VerificationStatus | null | undefined) =>
  status ? verificationLabel[status] : "Não enviada"

const FILTERS = {
  q: null,
  role: ["DRIVER", "PASSENGER", "ADMIN"],
  status: ["ACTIVE", "SUSPENDED", "BLOCKED", "DEACTIVATED"],
  verification: ["APPROVED", "PENDING_REVIEW", "REJECTED", "NONE"],
  sort: ["newest", "oldest"],
}

export default function UsersPage() {
  const { values, page, setFilters, setPage, clearFilters } =
    useUrlFilters(FILTERS)
  const [query, setQuery] = useSearchField(values.q, (q) => setFilters({ q }))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const sort = values.sort || "newest"
  const filtered = Boolean(
    values.q || values.role || values.status || values.verification,
  )

  const users = useQuery(
    () =>
      usersApi.list({
        q: values.q,
        role: values.role,
        status: values.status,
        verification: values.verification,
        sort,
        page,
      }),
    [values.q, values.role, values.status, values.verification, sort, page],
  )

  const columns: Column<AdminUserRow>[] = [
    {
      key: "user",
      header: "Usuário",
      primary: true,
      wrap: true,
      cell: (user) => (
        <button
          type="button"
          className="person-cell"
          onClick={() => setSelectedId(user.id)}
        >
          <Avatar initials={initialsOf(user.fullName)} />
          <span>
            <strong>{user.fullName}</strong>
            <small>{user.institutionalEmail}</small>
          </span>
        </button>
      ),
    },
    { key: "role", header: "Perfil", cell: (user) => primaryRole(user.roles) },
    { key: "course", header: "Curso", wrap: true, cell: (user) => user.course ?? "—" },
    {
      key: "verification",
      header: "Verificação",
      cell: (user) => (
        <Badge tone={user.verificationStatus ? undefined : "gray"}>
          {verificationText(user.verificationStatus)}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Conta",
      cell: (user) => <Badge>{userStatusLabel[user.status]}</Badge>,
    },
    {
      key: "created",
      header: "Cadastro",
      cell: (user) => formatDate(user.createdAt),
    },
    {
      key: "open",
      header: "Abrir",
      action: true,
      cell: (user) => (
        <button
          type="button"
          className="icon-button"
          onClick={() => setSelectedId(user.id)}
          aria-label={`Ver ${user.fullName}`}
        >
          <ChevronRight size={16} />
        </button>
      ),
    },
  ]

  return (
    <>
      <PageIntro
        title="Gestão de usuários"
        description="Consulte estudantes, perfis e situações cadastrais."
      />
      <section className="panel">
        <div className="table-toolbar">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Buscar por nome, e-mail ou matrícula"
          />
          <div className="filter-row filter-row-grow">
            <Select
              value={values.role}
              onChange={(role) => setFilters({ role })}
              ariaLabel="Filtrar perfil"
            >
              <option value="">Todos os perfis</option>
              <option value="DRIVER">Motorista</option>
              <option value="PASSENGER">Passageiro</option>
              <option value="ADMIN">Administrador</option>
            </Select>
            <Select
              value={values.status}
              onChange={(status) => setFilters({ status })}
              ariaLabel="Filtrar situação"
            >
              <option value="">Todas as situações</option>
              <option value="ACTIVE">Ativa</option>
              <option value="SUSPENDED">Suspensa</option>
              <option value="BLOCKED">Bloqueada</option>
              <option value="DEACTIVATED">Excluída</option>
            </Select>
            <Select
              value={values.verification}
              onChange={(verification) => setFilters({ verification })}
              ariaLabel="Filtrar verificação"
            >
              <option value="">Todas as verificações</option>
              <option value="APPROVED">Aprovada</option>
              <option value="PENDING_REVIEW">Pendente</option>
              <option value="REJECTED">Rejeitada</option>
              <option value="NONE">Não enviada</option>
            </Select>
            {filtered && (
              <Button variant="ghost" onClick={clearFilters}>
                Limpar filtros
              </Button>
            )}
            <Select
              value={sort}
              onChange={(next) =>
                setFilters({ sort: next === "newest" ? "" : next })
              }
              ariaLabel="Ordenar"
              highlightActive={false}
              className="push-end"
            >
              <option value="newest">Mais recentes</option>
              <option value="oldest">Mais antigos</option>
            </Select>
          </div>
        </div>
        <ListView
          query={users}
          label="Usuários"
          columns={columns}
          rowKey={(user) => user.id}
          empty={<EmptyState filtered={filtered} onClear={clearFilters} />}
          page={page}
          onPageChange={setPage}
          countLabel={(total) =>
            countOf(total, "usuário encontrado", "usuários encontrados")
          }
        />
      </section>
      {selectedId && (
        <UserDetails
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => void users.reload()}
        />
      )}
    </>
  )
}

function UserDetails({
  id,
  onClose,
  onChanged,
}: {
  id: string
  onClose: () => void
  onChanged: () => void
}) {
  const { user: me } = useAuth()
  const detail = useQuery(() => usersApi.detail(id), [id])
  const [target, setTarget] = useState<UserStatus | null>(null)
  const user = detail.data

  return (
    <>
      <Modal
        title="Perfil do usuário"
        description={`Identificador ${shortId(id)}`}
        onClose={onClose}
        width="lg"
      >
        {detail.error ? (
          <ErrorState error={detail.error} onRetry={detail.reload} />
        ) : !user ? (
          <Loading />
        ) : (
          <>
            <div className="profile-hero">
              <Avatar initials={initialsOf(user.fullName)} size="lg" />
              <div>
                <h3>{user.fullName}</h3>
                <p>{user.institutionalEmail}</p>
                <div className="profile-hero-badges">
                  <Badge>{userStatusLabel[user.status]}</Badge>
                  <Badge tone={user.academicVerification ? undefined : "gray"}>
                    {verificationText(user.academicVerification?.status)}
                  </Badge>
                  {user.roles.map((role) => (
                    <Badge key={role}>{roleLabel[role]}</Badge>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-body detail-content">
              <div className="detail-grid">
                <section>
                  <h4>Dados acadêmicos</h4>
                  <dl className="detail-list">
                    <div>
                      <dt>Curso</dt>
                      <dd>{user.course ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Período</dt>
                      <dd>{user.semester ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Matrícula</dt>
                      <dd>{user.studentNumber ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Vínculo</dt>
                      <dd>
                        {verificationText(user.academicVerification?.status)}
                      </dd>
                    </div>
                    <div>
                      <dt>Cadastro</dt>
                      <dd>{formatDate(user.createdAt)}</dd>
                    </div>
                  </dl>
                </section>
                <section>
                  <h4>Atividade na plataforma</h4>
                  <dl className="detail-list">
                    <div>
                      <dt>Caronas como motorista</dt>
                      <dd>{user.counts.drivenRides}</dd>
                    </div>
                    <div>
                      <dt>Reservas como passageiro</dt>
                      <dd>{user.counts.reservations}</dd>
                    </div>
                    <div>
                      <dt>Avaliação</dt>
                      <dd>
                        {user.rating.average === null ? (
                          "Sem avaliações"
                        ) : (
                          <>
                            <Star size={13} fill="#f59e0b" color="#f59e0b" aria-hidden="true" />
                            {user.rating.average.toLocaleString("pt-BR", {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 1,
                            })}{" "}
                            (
                            {user.rating.count})
                          </>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Denúncias contra</dt>
                      <dd>{user.counts.incidentsAgainst}</dd>
                    </div>
                    <div>
                      <dt>Denúncias feitas</dt>
                      <dd>{user.counts.incidentsReported}</dd>
                    </div>
                  </dl>
                </section>
              </div>
              {user.vehicles.length > 0 && (
                <section>
                  <h4>Veículos ativos</h4>
                  <p>Informação declarada pelo estudante</p>
                  {user.vehicles.map((vehicle) => (
                    <div className="vehicle-row" key={vehicle.id}>
                      <strong>
                        {vehicle.brand} {vehicle.model} {vehicle.year}
                      </strong>
                      <small>
                        {vehicle.color}, placa {vehicle.plate}
                      </small>
                    </div>
                  ))}
                </section>
              )}
              {user.adminHistory.length > 0 && (
                <section>
                  <h4>Decisões administrativas</h4>
                  <p>Últimas alterações de situação desta conta</p>
                  <div className="timeline">
                    {user.adminHistory.map((entry) => (
                      <span className="timeline-item" key={entry.id}>
                        <span>
                          {auditActionLabel(entry.action)}
                          {typeof entry.metadata?.reason === "string"
                            ? `: ${entry.metadata.reason}`
                            : ""}
                        </span>
                        <small>{formatDateTime(entry.createdAt)}</small>
                      </span>
                    ))}
                  </div>
                </section>
              )}
              <p className="quiet-note">
                <LockKeyhole size={14} aria-hidden="true" />
                <span>
                  CPF, telefone e senha não são enviados ao painel. A placa
                  aparece mascarada.
                </span>
              </p>
            </div>
            <footer className="modal-footer">
              <Button variant="secondary" onClick={onClose}>
                Fechar
              </Button>
              <StatusActions user={user} isSelf={me?.id === id} onPick={setTarget} />
            </footer>
          </>
        )}
      </Modal>
      {target && user && (
        <StatusChangeModal
          user={user}
          target={target}
          onClose={() => setTarget(null)}
          onDone={() => {
            setTarget(null)
            onChanged()
            void detail.reload()
          }}
        />
      )}
    </>
  )
}

function StatusActions({
  user,
  isSelf,
  onPick,
}: {
  user: AdminUserDetail
  isSelf: boolean
  onPick: (status: UserStatus) => void
}) {
  if (isSelf || user.status === "DEACTIVATED" || user.deletedAt) return null
  return (
    <>
      {user.status !== "ACTIVE" && (
        <Button onClick={() => onPick("ACTIVE")}>Reativar conta</Button>
      )}
      {user.status === "ACTIVE" && (
        <Button variant="secondary" onClick={() => onPick("SUSPENDED")}>
          Suspender conta
        </Button>
      )}
      {user.status !== "BLOCKED" && (
        <Button variant="secondary" onClick={() => onPick("BLOCKED")}>
          Bloquear conta
        </Button>
      )}
    </>
  )
}

const statusCopy: Record<
  string,
  { title: string; confirm: string; done: string; describe: (name: string) => string }
> = {
  SUSPENDED: {
    title: "Suspender conta",
    confirm: "Confirmar suspensão",
    done: "Conta suspensa",
    describe: (name) =>
      `${name} perde o acesso à plataforma até uma reativação administrativa.`,
  },
  BLOCKED: {
    title: "Bloquear conta",
    confirm: "Confirmar bloqueio",
    done: "Conta bloqueada",
    describe: (name) =>
      `${name} perde o acesso à plataforma. Use em casos graves.`,
  },
  ACTIVE: {
    title: "Reativar conta",
    confirm: "Reativar conta",
    done: "Conta reativada",
    describe: (name) =>
      `O acesso de ${name} será restabelecido. Caronas e reservas já canceladas não voltam.`,
  },
}

function StatusChangeModal({
  user,
  target,
  onClose,
  onDone,
}: {
  user: AdminUserDetail
  target: UserStatus
  onClose: () => void
  onDone: () => void
}) {
  const { showToast, refreshSummary } = useAdmin()
  const restrictingActive = target !== "ACTIVE" && user.status === "ACTIVE"
  const impactQuery = useQuery(
    () =>
      restrictingActive
        ? usersApi.impact(user.id)
        : Promise.resolve<UserImpact | null>(null),
    [user.id, restrictingActive],
  )
  const [impactOverride, setImpactOverride] = useState<UserImpact>()
  const impact = impactOverride ?? impactQuery.data ?? undefined
  const copy = statusCopy[target]

  if (restrictingActive && !impact) {
    return (
      <Modal title={copy.title} onClose={onClose}>
        {impactQuery.error ? (
          <ErrorState error={impactQuery.error} onRetry={impactQuery.reload} />
        ) : (
          <Loading label="Verificando caronas e reservas da conta..." />
        )}
      </Modal>
    )
  }

  const commitments = impact
    ? impact.futureRidesAsDriver +
      impact.reservationsAsPassenger +
      impact.pendingRequestsAsPassenger
    : 0

  async function confirm(reason: string) {
    try {
      const result = await usersApi.changeStatus(user.id, {
        status: target,
        reason,
        ...(commitments > 0 ? { confirmImpact: true } : {}),
      })
      const { ridesCancelled, reservationsCancelled, requestsCancelled } =
        result.consequences
      const effects = ridesCancelled + reservationsCancelled + requestsCancelled
      showToast(
        result.notificationsDelivered
          ? {
              message: effects
                ? `${copy.done}. Canceladas: ${countOf(ridesCancelled, "carona", "caronas")}, ${countOf(reservationsCancelled, "reserva", "reservas")} e ${countOf(requestsCancelled, "solicitação", "solicitações")}.`
                : `${copy.done}.`,
            }
          : {
              type: "error",
              message:
                "A decisão foi salva, mas parte dos participantes não foi notificada. Avise-os por outro canal.",
            },
      )
      refreshSummary()
      onDone()
    } catch (error) {
      // A situação mudou entre a prévia e a confirmação: mostra o impacto novo.
      if (
        error instanceof ApiError &&
        error.code === "IMPACT_CONFIRMATION_REQUIRED" &&
        error.body?.impact
      )
        setImpactOverride(error.body.impact as UserImpact)
      throw error
    }
  }

  return (
    <ConfirmModal
      title={copy.title}
      description={copy.describe(user.fullName)}
      confirmLabel={copy.confirm}
      destructive={target !== "ACTIVE"}
      requireReason
      reasonMinLength={5}
      confirmDisabled={Boolean(impact?.ridesInProgress)}
      onClose={onClose}
      onConfirm={confirm}
    >
      {impact && impact.ridesInProgress > 0 && (
        <p className="form-error impact-note" role="alert">
          O motorista tem carona em andamento. A restrição só é possível depois
          que ela terminar.
        </p>
      )}
      {commitments > 0 && (
        <div className="impact-note" role="group" aria-label="Impacto da ação">
          <strong>Ao confirmar, serão cancelados e notificados:</strong>
          <ul>
            {impact!.futureRidesAsDriver > 0 && (
              <li>
                {countOf(
                  impact!.futureRidesAsDriver,
                  "carona futura",
                  "caronas futuras",
                )}{" "}
                como motorista, afetando{" "}
                {countOf(impact!.passengersAffected, "passageiro", "passageiros")}
              </li>
            )}
            {impact!.reservationsAsPassenger > 0 && (
              <li>
                {countOf(impact!.reservationsAsPassenger, "reserva", "reservas")}{" "}
                como passageiro
              </li>
            )}
            {impact!.pendingRequestsAsPassenger > 0 && (
              <li>
                {countOf(
                  impact!.pendingRequestsAsPassenger,
                  "solicitação pendente",
                  "solicitações pendentes",
                )}
              </li>
            )}
          </ul>
        </div>
      )}
    </ConfirmModal>
  )
}
