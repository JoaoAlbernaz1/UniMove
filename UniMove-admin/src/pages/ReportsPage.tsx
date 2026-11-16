import { useState } from "react"
import { Download, LoaderCircle } from "lucide-react"
import { MeterList, PeriodFilter } from "../components/charts"
import { TrendChart } from "../components/TrendChart"
import {
  Button,
  EmptyState,
  ErrorState,
  PageIntro,
  TableSkeleton,
} from "../components/ui"
import { useQuery } from "../hooks/useQuery"
import { useUrlFilters } from "../hooks/useUrlFilters"
import { useAdmin } from "../layout/AdminContext"
import {
  formatMoney,
  formatRate,
  formatShare,
} from "../lib/format"
import { incidentTypeLabel, verificationLabel } from "../lib/labels"
import { reportsApi } from "../services/adminApi"
import type {
  IncidentType,
  ReportType,
  VerificationStatus,
} from "../types/api"

const FILTERS = { dias: ["7", "30", "90"] }

const EXPORTS: { type: ReportType; label: string }[] = [
  { type: "users", label: "Usuários" },
  { type: "rides", label: "Caronas" },
  { type: "verifications", label: "Verificações" },
  { type: "incidents", label: "Denúncias" },
]

const VERIFICATION_BARS: { status: VerificationStatus; color: string }[] = [
  { status: "APPROVED", color: "#16a34a" },
  { status: "REJECTED", color: "#d92d20" },
  { status: "PENDING_REVIEW", color: "#f59e0b" },
]

function NoData() {
  return <EmptyState title="Sem dados no período" description="" compact />
}

export default function ReportsPage() {
  const { showToast, updateSearch } = useAdmin()
  const { values } = useUrlFilters(FILTERS)
  const days = Number(values.dias || 30)
  const [exporting, setExporting] = useState<ReportType | null>(null)
  const report = useQuery(() => reportsApi.summary(days), [days])

  async function exportCsv(type: ReportType) {
    setExporting(type)
    try {
      const { truncated } = await reportsApi.download(type, days)
      showToast(
        truncated
          ? {
              type: "error",
              message:
                "Relatório exportado até o limite de 5.000 linhas. Reduza o período para ver tudo.",
            }
          : { message: "Relatório CSV exportado." },
      )
    } catch (error) {
      showToast({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível exportar o relatório.",
      })
    } finally {
      setExporting(null)
    }
  }

  const data = report.data
  const series = data?.series ?? []
  const verificationTotal = VERIFICATION_BARS.reduce(
    (total, { status }) => total + (data?.verifications[status] ?? 0),
    0,
  )
  const incidentEntries = Object.entries(data?.incidentsByType ?? {}) as [
    IncidentType,
    number,
  ][]
  const incidentTotal = incidentEntries.reduce((sum, [, n]) => sum + n, 0)
  const topRides = data?.topOrigins[0]?.rides ?? 0
  const busy = report.loading && Boolean(data)

  return (
    <>
      <PageIntro
        title="Relatórios"
        description="Indicadores calculados a partir dos registros da plataforma."
        action={
          <PeriodFilter
            value={days}
            onChange={(next) =>
              updateSearch({ dias: next === 30 ? "" : String(next) })
            }
          />
        }
      />
      {report.error ? (
        <ErrorState error={report.error} onRetry={report.reload} />
      ) : !data ? (
        <TableSkeleton columns={3} />
      ) : (
        <div aria-busy={busy} data-busy={busy}>
          <div
            className="stat-band"
            style={{ "--stat-columns": 4 } as React.CSSProperties}
          >
            <div>
              <span className="stat-label">Taxa de conclusão</span>
              <strong className="stat-value">{formatRate(data.completionRate)}</strong>
              <span className="stat-note">Concluídas entre concluídas e canceladas</span>
            </div>
            <div>
              <span className="stat-label">Taxa de cancelamento</span>
              <strong className="stat-value">{formatRate(data.cancellationRate)}</strong>
              <span className="stat-note">Canceladas entre concluídas e canceladas</span>
            </div>
            <div>
              <span className="stat-label">Solicitações aceitas</span>
              <strong className="stat-value">{formatRate(data.requestAcceptanceRate)}</strong>
              <span className="stat-note">Entre aceitas, recusadas e expiradas</span>
            </div>
            <div>
              <span className="stat-label">Estimativa anunciada</span>
              <strong className="stat-value">{formatMoney(data.estimatedValueCents)}</strong>
              <span className="stat-note">Não representa pagamentos</span>
            </div>
          </div>
          <div className="reports-grid">
            <section className="panel span-4">
              <div className="section-heading">
                <div>
                  <h2>Caronas por período</h2>
                  <p>Caronas publicadas por dia</p>
                </div>
              </div>
              {series.every((point) => point.rides === 0) ? (
                <EmptyState
                  title="Sem caronas no período"
                  description="Escolha um período maior ou aguarde novos registros."
                  compact
                />
              ) : (
                <TrendChart series={series} metric="rides" size="large" />
              )}
            </section>
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Regiões mais utilizadas</h2>
                  <p>Principais origens no período</p>
                </div>
              </div>
              {data.topOrigins.length ? (
                <MeterList
                  items={data.topOrigins.map((region) => ({
                    key: region.name,
                    label: region.name,
                    value: region.rides,
                    percent: (region.rides / topRides) * 100,
                  }))}
                />
              ) : (
                <NoData />
              )}
            </section>
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Verificações acadêmicas</h2>
                  <p>Enviadas no período</p>
                </div>
              </div>
              {verificationTotal ? (
                <MeterList
                  items={VERIFICATION_BARS.map(({ status, color }) => {
                    const count = data.verifications[status] ?? 0
                    return {
                      key: status,
                      label: verificationLabel[status],
                      value: count,
                      share: formatShare(count, verificationTotal),
                      percent: (count / verificationTotal) * 100,
                      color,
                    }
                  })}
                />
              ) : (
                <NoData />
              )}
            </section>
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Denúncias por categoria</h2>
                  <p>Registradas no período</p>
                </div>
              </div>
              {incidentEntries.length ? (
                <MeterList
                  items={incidentEntries.map(([type, count]) => ({
                    key: type,
                    label: incidentTypeLabel[type],
                    value: count,
                    share: formatShare(count, incidentTotal),
                    percent: (count / incidentTotal) * 100,
                  }))}
                />
              ) : (
                <NoData />
              )}
            </section>
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Exportar CSV</h2>
                  <p>
                    Últimos {days} dias, sem CPF, e-mail, matrícula, GUID, placa
                    ou textos livres. Toda exportação é auditada.
                  </p>
                </div>
              </div>
              <div className="export-actions">
                {EXPORTS.map(({ type, label }) => (
                  <Button
                    key={type}
                    variant="secondary"
                    disabled={exporting !== null}
                    onClick={() => void exportCsv(type)}
                  >
                    {exporting === type ? (
                      <LoaderCircle size={15} className="spin" aria-hidden="true" />
                    ) : (
                      <Download size={15} aria-hidden="true" />
                    )}
                    {exporting === type ? "Exportando..." : label}
                  </Button>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  )
}
