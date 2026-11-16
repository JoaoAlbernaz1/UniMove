import { ChevronRight, RefreshCw } from "lucide-react"
import { PeriodFilter, SegmentChart } from "../components/charts"
import { TrendChart } from "../components/TrendChart"
import {
  EmptyState,
  ErrorState,
  PageIntro,
  TableSkeleton,
} from "../components/ui"
import { useQuery } from "../hooks/useQuery"
import { useUrlFilters } from "../hooks/useUrlFilters"
import {
  formatDateTime,
  formatNumber,
  formatShare,
  formatTime,
} from "../lib/format"
import { auditActionLabel } from "../lib/labels"
import { useAdmin } from "../layout/AdminContext"
import { auditApi, dashboardApi } from "../services/adminApi"
import type { SeriesPoint } from "../types/api"

const FILTERS = { dias: ["7", "30", "90"] }

/** Cores validadas para daltonismo e contraste, na ordem em que aparecem na barra. */
const RIDE_STATUS_COLORS = {
  completed: "#15803d",
  open: "#38bdf8",
  scheduled: "#7c3aed",
  inProgress: "#f59e0b",
  cancelled: "#be123c",
}

const totalOf = (series: SeriesPoint[], metric: "rides" | "users") =>
  series.reduce((sum, point) => sum + point[metric], 0)

function Stat({
  label,
  value,
  note,
}: {
  label: string
  value: number
  note: string
}) {
  return (
    <div>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{formatNumber(value)}</strong>
      <span className="stat-note">{note}</span>
    </div>
  )
}

function PeriodTotal({ value }: { value: number }) {
  return (
    <div className="chart-total">
      {formatNumber(value)}
      <small>no período</small>
    </div>
  )
}

export default function DashboardPage() {
  const { navigate, summary, summaryError, refreshSummary, updateSearch } =
    useAdmin()
  const { values } = useUrlFilters(FILTERS)
  const days = Number(values.dias || 7)
  const seriesQuery = useQuery(() => dashboardApi.series(days), [days])
  const activityQuery = useQuery(() => auditApi.list({ limit: 6 }), [])

  if (summaryError && !summary)
    return <ErrorState error={summaryError} onRetry={refreshSummary} />
  if (!summary) return <TableSkeleton columns={3} />

  const refresh = () => {
    refreshSummary()
    void seriesQuery.reload()
    void activityQuery.reload()
  }

  const { users, rides, verifications, incidents } = summary
  const segments = [
    { name: "Concluídas", value: rides.completed, color: RIDE_STATUS_COLORS.completed },
    { name: "Abertas", value: rides.open, color: RIDE_STATUS_COLORS.open },
    { name: "Agendadas", value: rides.scheduled, color: RIDE_STATUS_COLORS.scheduled },
    { name: "Em andamento", value: rides.inProgress, color: RIDE_STATUS_COLORS.inProgress },
    { name: "Canceladas", value: rides.cancelled, color: RIDE_STATUS_COLORS.cancelled },
  ]
  const totalRides = segments.reduce((total, item) => total + item.value, 0)
  const series = seriesQuery.data ?? []
  const busy = seriesQuery.loading && Boolean(seriesQuery.data)

  return (
    <>
      <PageIntro
        title="Visão geral"
        description="O que precisa de ação agora e como a plataforma está sendo usada."
        action={
          <>
            <span className="updated-at">
              Atualizado às {formatTime(summary.generatedAt)}
            </span>
            <button
              type="button"
              className="icon-button"
              onClick={refresh}
              aria-label="Atualizar dados"
            >
              <RefreshCw size={15} />
            </button>
          </>
        }
      />

      <section className="panel attention" aria-label="Precisa de atenção">
        <button
          type="button"
          className="attention-row"
          data-pending={verifications.pending > 0}
          onClick={() => navigate("verifications")}
        >
          <span className="attention-count">
            {formatNumber(verifications.pending)}
          </span>
          <span className="attention-text">
            <strong>Verificações pendentes</strong>
            <small>
              {verifications.pending
                ? `${formatNumber(verifications.pendingOver24h)} há mais de 24 horas`
                : "Nada aguardando revisão"}
            </small>
          </span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="attention-row"
          data-pending={incidents.open > 0}
          onClick={() => navigate("moderation")}
        >
          <span className="attention-count">{formatNumber(incidents.open)}</span>
          <span className="attention-text">
            <strong>Denúncias abertas</strong>
            <small>{formatNumber(incidents.underReview)} em análise</small>
          </span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </section>

      <div className="stat-groups">
        <section className="stat-group">
          <h2>Usuários</h2>
          <div className="stat-band">
            <Stat
              label="Cadastrados"
              value={users.total}
              note="Contas não excluídas"
            />
            <Stat
              label="Ativos"
              value={users.active}
              note={`${formatShare(users.active, users.total)} da base`}
            />
            <Stat
              label="Motoristas"
              value={users.drivers}
              note={`${formatShare(users.drivers, users.total)} da base`}
            />
          </div>
        </section>
        <section className="stat-group">
          <h2>Caronas</h2>
          <div className="stat-band">
            <Stat
              label="Abertas"
              value={rides.open}
              note={`${formatNumber(rides.scheduled)} agendadas`}
            />
            <Stat
              label="Em andamento"
              value={rides.inProgress}
              note="Agora"
            />
            <Stat
              label="Concluídas"
              value={rides.completed}
              note="Desde o início"
            />
          </div>
        </section>
      </div>

      <div className="dashboard-section-title">
        <h2>Movimento recente</h2>
        <PeriodFilter
          value={days}
          onChange={(next) =>
            updateSearch({ dias: next === 7 ? "" : String(next) })
          }
        />
      </div>
      <div className="dashboard-charts">
        <section className="panel" aria-busy={busy} data-busy={busy}>
          <div className="section-heading">
            <div>
              <h2>Caronas publicadas</h2>
              <p>Caronas criadas por dia</p>
            </div>
            {totalOf(series, "rides") > 0 && (
              <PeriodTotal value={totalOf(series, "rides")} />
            )}
          </div>
          {seriesQuery.error ? (
            <ErrorState error={seriesQuery.error} onRetry={seriesQuery.reload} />
          ) : !seriesQuery.data ? (
            <TableSkeleton columns={2} />
          ) : totalOf(series, "rides") === 0 ? (
            <EmptyState
              title="Sem caronas no período"
              description="Nenhuma carona foi publicada nestes dias."
              compact
            />
          ) : (
            <TrendChart series={series} metric="rides" />
          )}
        </section>
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>Status das caronas</h2>
              <p>Todas as caronas, sem filtro de período</p>
            </div>
            {totalRides > 0 && (
              <div className="chart-total">
                {formatNumber(totalRides)}
                <small>no total</small>
              </div>
            )}
          </div>
          {totalRides === 0 ? (
            <EmptyState
              title="Sem caronas"
              description="A distribuição aparece quando houver caronas."
              compact
            />
          ) : (
            <SegmentChart segments={segments} />
          )}
        </section>
      </div>
      <div className="dashboard-lower">
        <section className="panel" aria-busy={busy} data-busy={busy}>
          <div className="section-heading">
            <div>
              <h2>Novos cadastros</h2>
              <p>Estudantes que entraram por dia</p>
            </div>
            {totalOf(series, "users") > 0 && (
              <PeriodTotal value={totalOf(series, "users")} />
            )}
          </div>
          {seriesQuery.error ? (
            <ErrorState error={seriesQuery.error} onRetry={seriesQuery.reload} />
          ) : !seriesQuery.data ? (
            <TableSkeleton columns={2} />
          ) : totalOf(series, "users") === 0 ? (
            <EmptyState
              title="Sem cadastros no período"
              description="Nenhuma conta foi criada nestes dias."
              compact
            />
          ) : (
            <TrendChart series={series} metric="users" size="small" />
          )}
        </section>
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>Atividades recentes</h2>
              <p>Últimos registros da auditoria</p>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => navigate("audit")}
            >
              Ver auditoria <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
          {activityQuery.error ? (
            <ErrorState
              error={activityQuery.error}
              onRetry={activityQuery.reload}
            />
          ) : !activityQuery.data ? (
            <TableSkeleton columns={1} />
          ) : !activityQuery.data.items.length ? (
            <EmptyState
              title="Nenhuma atividade registrada"
              description="Os registros aparecem aqui conforme a plataforma é usada."
              compact
            />
          ) : (
            <div className="activity-list">
              {activityQuery.data.items.map((item) => (
                <div className="activity-row" key={item.id}>
                  <div>
                    <strong>{auditActionLabel(item.action)}</strong>
                    <span>{item.actor?.fullName ?? "Sistema"}</span>
                  </div>
                  <time dateTime={item.createdAt}>
                    {formatDateTime(item.createdAt)}
                  </time>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  )
}
