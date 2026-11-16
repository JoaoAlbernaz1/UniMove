import { useId, useState } from "react"
import { LockKeyhole } from "lucide-react"
import { ListView, type Column } from "../components/DataTable"
import { TabPanel, Tabs } from "../components/Tabs"
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Loading,
  Modal,
  PageIntro,
  ReasonField,
  StatusFilter,
} from "../components/ui"
import { useQuery } from "../hooks/useQuery"
import { useUrlFilters } from "../hooks/useUrlFilters"
import { useAdmin } from "../layout/AdminContext"
import { countOf, formatDateTime, shortId } from "../lib/format"
import {
  auditActionLabel,
  incidentStatusLabel,
  incidentTypeLabel,
  rideStatusLabel,
} from "../lib/labels"
import { incidentsApi } from "../services/adminApi"
import { ApiError } from "../services/http"
import type { IncidentRow, IncidentStatus } from "../types/api"

const STATUSES: { status: IncidentStatus; label: string }[] = [
  { status: "OPEN", label: "Abertas" },
  { status: "UNDER_REVIEW", label: "Em análise" },
  { status: "RESOLVED", label: "Resolvidas" },
  { status: "DISMISSED", label: "Arquivadas" },
]
const FILTERS = { status: STATUSES.map((item) => item.status) }

const decisionMessage: Record<IncidentStatus, string> = {
  OPEN: "Denúncia reaberta.",
  UNDER_REVIEW: "Denúncia marcada como em análise.",
  RESOLVED: "Denúncia resolvida.",
  DISMISSED: "Denúncia arquivada.",
}

export default function ModerationPage() {
  const { values, page, setFilters, setPage, clearFilters } =
    useUrlFilters(FILTERS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const panelId = useId()

  const incidents = useQuery(
    () => incidentsApi.list({ status: values.status, page }),
    [values.status, page],
  )
  const counts = incidents.data?.statusCounts ?? {}
  const pending = (counts.OPEN ?? 0) + (counts.UNDER_REVIEW ?? 0)

  const columns: Column<IncidentRow>[] = [
    {
      key: "type",
      header: "Ocorrência",
      primary: true,
      cell: (item) => (
        <button
          type="button"
          className="person-cell"
          onClick={() => setSelectedId(item.id)}
        >
          <span>
            <strong>{incidentTypeLabel[item.type]}</strong>
            <small className="mono">{shortId(item.id)}</small>
          </span>
        </button>
      ),
    },
    {
      key: "people",
      header: "Envolvidos",
      wrap: true,
      cell: (item) => (
        <span className="involved">
          <span>
            <small>Denunciante: </small>
            {item.reportedBy.fullName}
          </span>
          <span>
            <small>Denunciado: </small>
            {item.reportedUser?.fullName ?? "Não informado"}
          </span>
        </span>
      ),
    },
    {
      key: "date",
      header: "Registro",
      cell: (item) => formatDateTime(item.createdAt),
    },
    {
      key: "status",
      header: "Situação",
      cell: (item) => <Badge>{incidentStatusLabel[item.status]}</Badge>,
    },
    {
      key: "open",
      header: "Abrir",
      action: true,
      cell: (item) => (
        <Button
          variant="secondary"
          size="small"
          onClick={() => setSelectedId(item.id)}
          aria-label={`Analisar denúncia ${shortId(item.id)}`}
        >
          Analisar
        </Button>
      ),
    },
  ]

  return (
    <>
      <PageIntro
        title="Central de moderação"
        description="Analise ocorrências e preserve a segurança da comunidade."
      />
      <section className="panel">
        <Tabs
          label="Tipos de moderação"
          panelId={panelId}
          value="incidents"
          onChange={() => {}}
          items={[
            {
              id: "incidents",
              label: "Denúncias",
              count: incidents.data ? pending : "—",
            },
            {
              id: "reviews",
              label: "Avaliações sinalizadas",
              count: "Em breve",
              disabled: true,
              hint: "Indisponível: o sistema ainda não tem sinalização de avaliações.",
            },
          ]}
        />
        <TabPanel panelId={panelId} active="incidents">
          <StatusFilter
            label="Filtrar denúncias por situação"
            value={values.status}
            onChange={(status) => setFilters({ status })}
            loaded={Boolean(incidents.data)}
            options={[
              { value: "", label: "Todas" },
              ...STATUSES.map(({ status, label }) => ({
                value: status,
                label,
                count: counts[status] ?? 0,
              })),
            ]}
          />
          <ListView
            query={incidents}
            label="Denúncias"
            columns={columns}
            rowKey={(item) => item.id}
            empty={
              <EmptyState
                title="Nenhuma denúncia encontrada"
                description={
                  values.status
                    ? undefined
                    : "As denúncias registradas no aplicativo aparecem aqui."
                }
                filtered={Boolean(values.status)}
                onClear={clearFilters}
              />
            }
            page={page}
            onPageChange={setPage}
            countLabel={(total) => countOf(total, "denúncia", "denúncias")}
          />
        </TabPanel>
      </section>
      <p className="quiet-note page-note">
        <LockKeyhole size={14} aria-hidden="true" />
        <span>
          Mensagens privadas não ficam disponíveis para consulta nesta central.
        </span>
      </p>
      {selectedId && (
        <IncidentDetails
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => void incidents.reload()}
        />
      )}
    </>
  )
}

function IncidentDetails({
  id,
  onClose,
  onChanged,
}: {
  id: string
  onClose: () => void
  onChanged: () => void
}) {
  const { showToast, refreshSummary } = useAdmin()
  const detail = useQuery(() => incidentsApi.detail(id), [id])
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const incident = detail.data
  const finished =
    incident?.status === "RESOLVED" || incident?.status === "DISMISSED"

  async function decide(status: IncidentStatus) {
    const text = note.trim()
    if (status !== "UNDER_REVIEW" && !text) {
      setError("Registre a justificativa antes de concluir a denúncia.")
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const result = await incidentsApi.update(id, {
        status,
        ...(text ? { note: text } : {}),
      })
      showToast(
        result.notificationDelivered
          ? { message: decisionMessage[status] }
          : {
              type: "error",
              message:
                "A decisão foi salva, mas o denunciante não foi notificado.",
            },
      )
      refreshSummary()
      onChanged()
      onClose()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível registrar a decisão.",
      )
      // A denúncia mudou enquanto a tela estava aberta: mostra a situação atual.
      if (reason instanceof ApiError && reason.status === 409) {
        void detail.reload()
        onChanged()
      }
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Analisar denúncia ${shortId(id)}`}
      description={
        incident ? `Registrada em ${formatDateTime(incident.createdAt)}` : undefined
      }
      onClose={onClose}
      width="lg"
      dismissible={!busy}
      closeOnBackdrop={!note}
    >
      {detail.error ? (
        <ErrorState error={detail.error} onRetry={detail.reload} />
      ) : !incident ? (
        <Loading />
      ) : (
        <>
          <div className="modal-body detail-content">
            <section>
              <h4>{incidentTypeLabel[incident.type]}</h4>
              <p className="report-text">{incident.description}</p>
            </section>
            <dl className="detail-list">
              <div>
                <dt>Denunciante</dt>
                <dd>{incident.reportedBy.fullName}</dd>
              </div>
              <div>
                <dt>Usuário denunciado</dt>
                <dd>{incident.reportedUser?.fullName ?? "Não informado"}</dd>
              </div>
              <div>
                <dt>Carona relacionada</dt>
                <dd>
                  {incident.ride.originLocation.name} para{" "}
                  {incident.ride.destinationLocation.name}
                </dd>
              </div>
              <div>
                <dt>Motorista e situação da carona</dt>
                <dd>
                  {incident.ride.driver.fullName},{" "}
                  {rideStatusLabel[incident.ride.status].toLowerCase()}
                </dd>
              </div>
              <div>
                <dt>Situação da denúncia</dt>
                <dd>
                  <Badge>{incidentStatusLabel[incident.status]}</Badge>
                </dd>
              </div>
            </dl>
            {incident.decisions.length > 0 && (
              <section>
                <h4>Decisões registradas</h4>
                <div className="timeline">
                  {incident.decisions.map((entry) => (
                    <span className="timeline-item" key={entry.id}>
                      <span>
                        {auditActionLabel(entry.action)}
                        {typeof entry.metadata?.note === "string"
                          ? `: ${entry.metadata.note}`
                          : ""}
                      </span>
                      <small>
                        {entry.actor?.fullName ?? "Sistema"},{" "}
                        {formatDateTime(entry.createdAt)}
                      </small>
                    </span>
                  ))}
                </div>
              </section>
            )}
            {!finished && (
              <ReasonField
                label="Registro da análise"
                value={note}
                onChange={setNote}
                maxLength={1000}
                placeholder="Registre a justificativa da decisão administrativa."
              />
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <footer className="modal-footer">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Fechar
            </Button>
            {incident.status === "OPEN" && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void decide("UNDER_REVIEW")}
              >
                Marcar em análise
              </Button>
            )}
            {!finished && (
              <>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void decide("DISMISSED")}
                >
                  Arquivar
                </Button>
                <Button disabled={busy} onClick={() => void decide("RESOLVED")}>
                  Resolver denúncia
                </Button>
              </>
            )}
          </footer>
        </>
      )}
    </Modal>
  )
}
