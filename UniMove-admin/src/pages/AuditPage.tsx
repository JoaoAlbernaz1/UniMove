import { useState } from "react"
import { LockKeyhole } from "lucide-react"
import { ListView, type Column } from "../components/DataTable"
import {
  Button,
  EmptyState,
  Modal,
  PageIntro,
  SearchInput,
  Select,
} from "../components/ui"
import { DateRangeFilter, dayRangeToApi } from "../components/DateRangeFilter"
import { useQuery } from "../hooks/useQuery"
import { DAY_FORMAT, useSearchField, useUrlFilters } from "../hooks/useUrlFilters"
import { countOf, formatDateTime, shortId } from "../lib/format"
import { auditActionLabel, auditDetailLabel } from "../lib/labels"
import { auditApi } from "../services/adminApi"
import type { AuditLogRow } from "../types/api"

const ENTITY_TYPES = [
  { value: "User", label: "Usuários" },
  { value: "AcademicVerification", label: "Verificações" },
  { value: "Incident", label: "Denúncias" },
  { value: "Report", label: "Relatórios" },
]

const FILTERS = {
  q: null,
  entityType: ENTITY_TYPES.map((item) => item.value),
  from: DAY_FORMAT,
  to: DAY_FORMAT,
}

function Resource({ log }: { log: AuditLogRow }) {
  const label =
    ENTITY_TYPES.find((item) => item.value === log.entityType)?.label ??
    log.entityType
  if (!log.entityId) return <>{label}</>
  return (
    <>
      {label}{" "}
      <span className="mono">
        {log.entityType === "Report" ? log.entityId : shortId(log.entityId)}
      </span>
    </>
  )
}

export default function AuditPage() {
  const { values, page, setFilters, setPage, clearFilters } =
    useUrlFilters(FILTERS)
  const [query, setQuery] = useSearchField(values.q, (q) => setFilters({ q }))
  const [selected, setSelected] = useState<AuditLogRow | null>(null)
  const filtered = Boolean(values.q || values.entityType || values.from || values.to)

  const logs = useQuery(
    () =>
      auditApi.list({
        q: values.q,
        entityType: values.entityType,
        page,
        ...dayRangeToApi(values),
      }),
    [values.q, values.entityType, values.from, values.to, page],
  )
  const details = Object.entries(selected?.metadata ?? {}).filter(
    ([, value]) => value !== null && value !== undefined,
  )

  const columns: Column<AuditLogRow>[] = [
    {
      key: "action",
      header: "Ação",
      primary: true,
      cell: (log) => (
        <span className="person-cell">
          <strong>{auditActionLabel(log.action)}</strong>
        </span>
      ),
    },
    {
      key: "actor",
      header: "Autor",
      cell: (log) => log.actor?.fullName ?? "Sistema",
    },
    {
      key: "resource",
      header: "Recurso",
      cell: (log) => <Resource log={log} />,
    },
    {
      key: "date",
      header: "Data e horário",
      cell: (log) => formatDateTime(log.createdAt),
    },
    {
      key: "open",
      header: "Detalhes",
      action: true,
      cell: (log) => (
        <Button
          variant="secondary"
          size="small"
          onClick={() => setSelected(log)}
          aria-label={`Ver detalhes: ${auditActionLabel(log.action)}, ${formatDateTime(log.createdAt)}`}
        >
          Ver detalhes
        </Button>
      ),
    },
  ]

  return (
    <>
      <PageIntro
        title="Auditoria"
        description="Registros das ações realizadas na plataforma, somente para leitura."
      />
      <section className="panel">
        <div className="table-toolbar">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Buscar ação, autor ou identificador"
          />
          <Select
            value={values.entityType}
            onChange={(entityType) => setFilters({ entityType })}
            ariaLabel="Filtrar recurso"
          >
            <option value="">Todos os recursos</option>
            {ENTITY_TYPES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
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
          query={logs}
          label="Registros de auditoria"
          columns={columns}
          rowKey={(log) => log.id}
          empty={<EmptyState filtered={filtered} onClear={clearFilters} />}
          page={page}
          onPageChange={setPage}
          countLabel={(total) => countOf(total, "registro", "registros")}
        />
      </section>
      {selected && (
        <Modal
          title="Detalhes do registro"
          description={formatDateTime(selected.createdAt)}
          onClose={() => setSelected(null)}
        >
          <div className="modal-body detail-content">
            <dl className="detail-list">
              <div>
                <dt>Autor</dt>
                <dd>{selected.actor?.fullName ?? "Sistema"}</dd>
              </div>
              <div>
                <dt>Ação</dt>
                <dd>{auditActionLabel(selected.action)}</dd>
              </div>
              <div>
                <dt>Recurso</dt>
                <dd>
                  <span>
                    <Resource log={selected} />
                  </span>
                </dd>
              </div>
            </dl>
            {details.length > 0 && (
              <section>
                <h4>Detalhes registrados</h4>
                <dl className="detail-list">
                  {details.map(([key, value]) => (
                    <div key={key}>
                      <dt>{auditDetailLabel(key)}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
            <p className="quiet-note">
              <LockKeyhole size={14} aria-hidden="true" />
              <span>A API não oferece alteração nem exclusão destes registros.</span>
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
