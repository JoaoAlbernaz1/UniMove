import { useState } from "react"
import { LockKeyhole } from "lucide-react"
import { ListView, type Column } from "../components/DataTable"
import { DateRangeFilter, dayRangeToApi } from "../components/DateRangeFilter"
import {
  Badge,
  Button,
  EmptyState,
  Modal,
  PageIntro,
  SearchInput,
  Select,
} from "../components/ui"
import { useQuery } from "../hooks/useQuery"
import { DAY_FORMAT, useSearchField, useUrlFilters } from "../hooks/useUrlFilters"
import { countOf, formatDateTime, shortId } from "../lib/format"
import { auditActionLabel, auditDetailLabel } from "../lib/labels"
import {
  AUDIT_FILTER_ACTIONS,
  auditResultLabel,
  auditTone,
} from "../lib/securityLabels"
import { securityHistoryApi } from "../services/adminIamApi"
import type { AuditEntryRow } from "../types/admin-iam"

const FILTERS = {
  q: null,
  action: [...AUDIT_FILTER_ACTIONS],
  from: DAY_FORMAT,
  to: DAY_FORMAT,
}

/** Metadado da auditoria é JSON livre: cada forma vira um texto legível. */
function describeValue(value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (Array.isArray(value)) return value.length ? value.join(", ") : "nenhum"
  if (typeof value === "boolean") return value ? "sim" : "não"
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

export default function SecurityHistoryPage() {
  const { values, page, setFilters, setPage, clearFilters } = useUrlFilters(FILTERS)
  const [query, setQuery] = useSearchField(values.q, (q) => setFilters({ q }))
  const [selected, setSelected] = useState<AuditEntryRow | null>(null)
  const filtered = Boolean(values.q || values.action || values.from || values.to)

  const events = useQuery(
    () =>
      securityHistoryApi.list({
        q: values.q || undefined,
        action: values.action || undefined,
        page,
        ...dayRangeToApi(values),
      }),
    [values.q, values.action, values.from, values.to, page],
  )
  const details = Object.entries(selected?.metadata ?? {}).filter(
    ([, value]) => value !== null && value !== undefined,
  )

  const columns: Column<AuditEntryRow>[] = [
    {
      key: "event",
      header: "Evento",
      primary: true,
      wrap: true,
      cell: (entry) => (
        <span className="person-cell">
          <span>
            <strong>{auditActionLabel(entry.action)}</strong>
            <small className="mono">{entry.action}</small>
          </span>
        </span>
      ),
    },
    {
      key: "actor",
      header: "Administrador",
      wrap: true,
      cell: (entry) => entry.actor?.fullName ?? "Sistema",
    },
    {
      key: "result",
      header: "Resultado",
      cell: (entry) => (
        <Badge tone={auditTone(entry.action)}>{auditResultLabel(entry.action)}</Badge>
      ),
    },
    {
      key: "date",
      header: "Data e horário",
      cell: (entry) => formatDateTime(entry.createdAt),
    },
    {
      key: "open",
      header: "Detalhes",
      action: true,
      cell: (entry) => (
        <Button
          variant="secondary"
          size="small"
          onClick={() => setSelected(entry)}
          aria-label={`Ver detalhes: ${auditActionLabel(entry.action)}, ${formatDateTime(entry.createdAt)}`}
        >
          Ver detalhes
        </Button>
      ),
    },
  ]

  return (
    <>
      <PageIntro
        title="Histórico de segurança"
        description="Trilha de auditoria de login, segundo fator, convites, permissões e sessões."
      />
      <section className="panel">
        <div className="table-toolbar">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Buscar evento, administrador ou identificador"
          />
          <Select
            value={values.action}
            onChange={(action) => setFilters({ action })}
            ariaLabel="Filtrar evento"
          >
            <option value="">Todos os eventos</option>
            {AUDIT_FILTER_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {auditActionLabel(action)}
              </option>
            ))}
          </Select>
          <span className="toolbar-spacer" />
          <DateRangeFilter
            value={values}
            onChange={({ from = "", to = "" }) => setFilters({ from, to })}
          />
        </div>
        <ListView
          query={events}
          label="Eventos de segurança"
          columns={columns}
          rowKey={(entry) => entry.id}
          empty={
            <EmptyState
              title="Nenhum evento de segurança no período"
              filtered={filtered}
              onClear={clearFilters}
            />
          }
          page={page}
          onPageChange={setPage}
          countLabel={(total) => countOf(total, "evento", "eventos")}
        />
      </section>

      {selected && (
        <Modal
          title={auditActionLabel(selected.action)}
          description={formatDateTime(selected.createdAt)}
          onClose={() => setSelected(null)}
        >
          <div className="modal-body detail-content">
            <dl className="detail-list">
              <div>
                <dt>Código do evento</dt>
                <dd className="mono">{selected.action}</dd>
              </div>
              <div>
                <dt>Administrador</dt>
                <dd>{selected.actor?.fullName ?? "Sistema"}</dd>
              </div>
              <div>
                <dt>Entidade</dt>
                <dd>
                  {selected.entityType}
                  {selected.entityId ? (
                    <span className="mono"> {shortId(selected.entityId)}</span>
                  ) : null}
                </dd>
              </div>
            </dl>
            {details.length > 0 && (
              <section>
                <h4>Informações registradas</h4>
                <dl className="detail-list">
                  {details.map(([key, value]) => (
                    <div key={key}>
                      <dt>{auditDetailLabel(key)}</dt>
                      <dd>{describeValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
            <p className="quiet-note">
              <LockKeyhole size={14} aria-hidden="true" />
              <span>
                A trilha não guarda senha, token, código de recuperação nem
                segredo do autenticador.
              </span>
            </p>
          </div>
          <footer className="modal-footer">
            <Button variant="secondary" onClick={() => setSelected(null)}>
              Fechar
            </Button>
          </footer>
        </Modal>
      )}
    </>
  )
}
