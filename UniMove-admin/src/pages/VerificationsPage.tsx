import { useId, useState } from "react"
import { CheckCircle2, Copy, ExternalLink, ShieldCheck } from "lucide-react"
import { ListView, type Column } from "../components/DataTable"
import { TabPanel, Tabs } from "../components/Tabs"
import {
  Avatar,
  Badge,
  Button,
  ConfirmModal,
  EmptyState,
  Modal,
  PageIntro,
} from "../components/ui"
import { TOTVS_VALIDATOR_URL } from "../config"
import { useQuery } from "../hooks/useQuery"
import { useUrlFilters } from "../hooks/useUrlFilters"
import { useAdmin } from "../layout/AdminContext"
import { countOf, formatDateTime, formatNumber, initialsOf } from "../lib/format"
import { verificationLabel } from "../lib/labels"
import { verificationsApi } from "../services/adminApi"
import { ApiError } from "../services/http"
import type { VerificationRow, VerificationStatus } from "../types/api"

const TABS: { status: VerificationStatus; label: string }[] = [
  { status: "PENDING_REVIEW", label: "Pendentes" },
  { status: "APPROVED", label: "Aprovadas" },
  { status: "REJECTED", label: "Rejeitadas" },
]
const FILTERS = { status: TABS.map((item) => item.status) }

export default function VerificationsPage() {
  const { showToast, refreshSummary } = useAdmin()
  const { values, page, setFilters, setPage } = useUrlFilters(FILTERS)
  const tab = (values.status || "PENDING_REVIEW") as VerificationStatus
  const [selected, setSelected] = useState<VerificationRow | null>(null)
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null)
  // Evita que um erro 5xx leve a novos envios repetidos da mesma decisão.
  const [serverFailure, setServerFailure] = useState(false)

  function beginDecision(next: "approve" | "reject") {
    setServerFailure(false)
    setDecision(next)
  }
  const panelId = useId()

  const list = useQuery(() => verificationsApi.list(tab, page), [tab, page])
  const counts = useQuery(async () => {
    const results = await Promise.all(
      TABS.map(({ status }) => verificationsApi.list(status, 1, 1)),
    )
    return Object.fromEntries(
      TABS.map(({ status }, index) => [status, results[index].total]),
    ) as Record<VerificationStatus, number>
  }, [])

  const refresh = () => {
    void list.reload()
    void counts.reload()
    refreshSummary()
  }

  async function copyGuid(guid: string) {
    try {
      await navigator.clipboard.writeText(guid)
      showToast({ message: "GUID copiado." })
    } catch {
      showToast({
        type: "error",
        message:
          "O navegador bloqueou a cópia. Selecione o GUID na ficha e copie manualmente.",
      })
    }
  }

  async function decide(status: "APPROVED" | "REJECTED", reviewNote?: string) {
    if (!selected) return
    try {
      await verificationsApi.review(selected.userId, {
        status,
        ...(reviewNote ? { reviewNote } : {}),
      })
      showToast({
        message:
          status === "APPROVED"
            ? `Vínculo de ${selected.user.fullName} aprovado.`
            : `Vínculo de ${selected.user.fullName} rejeitado.`,
      })
      setDecision(null)
      setSelected(null)
      refresh()
    } catch (error) {
      // Outro administrador decidiu antes: a tela está velha, então recarrega.
      if (error instanceof ApiError && error.status === 409) {
        showToast({ type: "error", message: error.message })
        setDecision(null)
        setSelected(null)
        refresh()
        return
      }
      if (error instanceof ApiError && error.status >= 500) {
        setServerFailure(true)
        const action = status === "APPROVED" ? "aprovação" : "rejeição"
        throw new Error(
          `O servidor retornou erro ${error.status} durante a ${action}. A decisão não foi confirmada. Feche esta janela e atualize a lista para verificar a situação antes de tentar novamente. Se persistir, contate o suporte.`,
          { cause: error },
        )
      }
      throw error
    }
  }

  const columns: Column<VerificationRow>[] = [
    {
      key: "student",
      header: "Estudante",
      primary: true,
      wrap: true,
      cell: (item) => (
        <button
          type="button"
          className="person-cell"
          onClick={() => setSelected(item)}
        >
          <Avatar initials={initialsOf(item.user.fullName)} />
          <span>
            <strong>{item.user.fullName}</strong>
            <small>{item.user.institutionalEmail}</small>
          </span>
        </button>
      ),
    },
    {
      key: "number",
      header: "Matrícula",
      cell: (item) => (
        <span className="numeric">{item.user.studentNumber ?? "—"}</span>
      ),
    },
    { key: "course", header: "Curso", wrap: true, cell: (item) => item.user.course ?? "—" },
    {
      key: "sent",
      header: "Envio",
      cell: (item) => formatDateTime(item.submittedAt),
    },
    {
      key: "guid",
      header: "GUID",
      cell: (item) => (
        <span className="mono" title={item.reportGuid}>
          {item.reportGuid.slice(0, 8)}…
        </span>
      ),
    },
    ...(tab === "PENDING_REVIEW"
      ? []
      : [
          {
            key: "decision",
            header: "Decisão",
            cell: (item: VerificationRow) => (
              <>
                {formatDateTime(item.reviewedAt)}
                {item.reviewedBy && (
                  <span className="cell-secondary">
                    {item.reviewedBy.fullName}
                  </span>
                )}
              </>
            ),
          },
        ]),
    {
      key: "open",
      header: "Abrir",
      action: true,
      cell: (item) => (
        <Button
          variant="secondary"
          size="small"
          onClick={() => setSelected(item)}
          aria-label={`Revisar ${item.user.fullName}`}
        >
          {tab === "PENDING_REVIEW" ? "Revisar" : "Ver"}
        </Button>
      ),
    },
  ]

  return (
    <>
      <PageIntro
        title="Verificações acadêmicas"
        description="O UniCarona não guarda os PDFs depois do processamento. Confira os dados extraídos e o GUID no validador oficial."
      />
      <section className="panel">
        <Tabs
          label="Situação das solicitações"
          panelId={panelId}
          value={tab}
          onChange={(status) =>
            setFilters({ status: status === "PENDING_REVIEW" ? "" : status })
          }
          items={TABS.map(({ status, label }) => ({
            id: status,
            label,
            count: counts.data ? formatNumber(counts.data[status]) : "—",
          }))}
        />
        <TabPanel panelId={panelId} active={tab}>
          <ListView
            query={list}
            label={`Solicitações: ${verificationLabel[tab].toLowerCase()}`}
            columns={columns}
            rowKey={(item) => item.userId}
            empty={
              <EmptyState
                title={`Nenhuma solicitação ${verificationLabel[tab].toLowerCase()}`}
                description="As solicitações aparecem aqui quando estudantes enviam o comprovante."
              />
            }
            page={page}
            onPageChange={setPage}
            countLabel={(total) => countOf(total, "solicitação", "solicitações")}
          />
        </TabPanel>
      </section>
      {selected && (
        <Modal
          title="Revisão de vínculo"
          description={`Enviada em ${formatDateTime(selected.submittedAt)}`}
          onClose={() => setSelected(null)}
          width="lg"
        >
          <div className="profile-hero">
            <Avatar initials={initialsOf(selected.user.fullName)} size="lg" />
            <div>
              <h3>{selected.user.fullName}</h3>
              <p>{selected.user.institutionalEmail}</p>
              <Badge>{verificationLabel[selected.status]}</Badge>
            </div>
          </div>
          <div className="modal-body detail-content">
            <dl className="detail-list">
              <div>
                <dt>Matrícula</dt>
                <dd>{selected.user.studentNumber ?? "—"}</dd>
              </div>
              <div>
                <dt>Curso</dt>
                <dd>{selected.user.course ?? "—"}</dd>
              </div>
              <div>
                <dt>GUID do relatório</dt>
                <dd className="mono">{selected.reportGuid}</dd>
              </div>
              {selected.reviewedAt && (
                <div>
                  <dt>Decisão</dt>
                  <dd>
                    {formatDateTime(selected.reviewedAt)}
                    {selected.reviewedBy
                      ? `, ${selected.reviewedBy.fullName}`
                      : ""}
                  </dd>
                </div>
              )}
              {selected.reviewNote && (
                <div>
                  <dt>Motivo informado</dt>
                  <dd>{selected.reviewNote}</dd>
                </div>
              )}
            </dl>
            <div className="guid-row">
              <Button
                variant="secondary"
                onClick={() => void copyGuid(selected.reportGuid)}
              >
                <Copy size={15} aria-hidden="true" /> Copiar GUID
              </Button>
              <a
                className="button button-secondary"
                href={TOTVS_VALIDATOR_URL}
                target="_blank"
                rel="noreferrer noopener"
              >
                <ExternalLink size={15} aria-hidden="true" /> Abrir validador
                oficial TOTVS
                <span className="sr-only"> (abre em nova aba)</span>
              </a>
            </div>
            <p className="quiet-note">
              <ShieldCheck size={14} aria-hidden="true" />
              <span>
                Cole o GUID no validador e confirme se o relatório corresponde
                aos dados acadêmicos apresentados.
              </span>
            </p>
          </div>
          <footer className="modal-footer">
            <Button variant="secondary" onClick={() => setSelected(null)}>
              Fechar
            </Button>
            {selected.status === "PENDING_REVIEW" && (
              <>
                <Button variant="secondary" onClick={() => beginDecision("reject")}>
                  Rejeitar vínculo
                </Button>
                <Button onClick={() => beginDecision("approve")}>
                  <CheckCircle2 size={15} aria-hidden="true" /> Aprovar vínculo
                </Button>
              </>
            )}
          </footer>
        </Modal>
      )}
      {decision === "approve" && selected && (
        <ConfirmModal
          title="Aprovar vínculo acadêmico"
          description="Confirme que a autenticidade e a correspondência dos dados foram verificadas no validador oficial."
          confirmLabel="Confirmar aprovação"
          confirmDisabled={serverFailure}
          onClose={() => setDecision(null)}
          onConfirm={() => decide("APPROVED")}
        />
      )}
      {decision === "reject" && selected && (
        <ConfirmModal
          title="Rejeitar vínculo acadêmico"
          description="O estudante verá o motivo no aplicativo e poderá enviar uma nova comprovação."
          confirmLabel="Confirmar rejeição"
          confirmDisabled={serverFailure}
          destructive
          requireReason
          onClose={() => setDecision(null)}
          onConfirm={(reason) => decide("REJECTED", reason)}
        />
      )}
    </>
  )
}
