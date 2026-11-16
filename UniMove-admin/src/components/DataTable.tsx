import { type ReactNode, useEffect } from "react"
import { PAGE_SIZE } from "../config"
import type { ApiError } from "../services/http"
import type { ListResult } from "../types/api"
import { ErrorState, Pagination, TableSkeleton, cn } from "./ui"

export type Column<T> = {
  key: string
  header: string
  cell: (row: T) => ReactNode
  /** Vira o título do bloco no celular. */
  primary?: boolean
  /** Coluna de ação: cabeçalho só para leitores de tela. */
  action?: boolean
  /** Texto longo que pode quebrar linha. */
  wrap?: boolean
}

/**
 * Os papéis explícitos mantêm a semântica de tabela no celular, onde o CSS transforma
 * cada linha em um bloco e o navegador deixaria de expô-la como tabela.
 */
export function DataTable<T>({
  label,
  columns,
  rows,
  rowKey,
  busy = false,
}: {
  label: string
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  busy?: boolean
}) {
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      {busy && <span className="busy-bar" aria-hidden="true" />}
      <table className="data-table" role="table" aria-busy={busy}>
        <thead role="rowgroup">
          <tr role="row">
            {columns.map((column) => (
              <th key={column.key} scope="col" role="columnheader">
                {column.action ? (
                  <span className="sr-only">{column.header}</span>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((row) => (
            <tr key={rowKey(row)} role="row">
              {columns.map((column) => (
                <td
                  key={column.key}
                  role="cell"
                  data-label={column.header}
                  className={cn(
                    column.primary && "cell-primary",
                    column.action && "cell-action",
                    column.wrap && "cell-wrap",
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type ListQuery<T> = {
  data?: ListResult<T>
  error?: ApiError
  loading: boolean
  reload: () => void
}

/** Os estados de uma lista paginada: erro, carregamento, vazio e tabela. */
export function ListView<T>({
  query,
  label,
  columns,
  rowKey,
  empty,
  page,
  onPageChange,
  countLabel,
}: {
  query: ListQuery<T>
  label: string
  columns: Column<T>[]
  rowKey: (row: T) => string
  empty: ReactNode
  page: number
  onPageChange: (page: number) => void
  countLabel: (total: number) => string
}) {
  const total = query.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const stranded = Boolean(query.data && !query.data.items.length && page > 1)

  // A última linha da última página foi decidida, ou a URL pediu uma página que não existe.
  useEffect(() => {
    if (stranded) onPageChange(pages)
  }, [stranded, pages, onPageChange])

  if (query.error) return <ErrorState error={query.error} onRetry={query.reload} />
  if (!query.data || stranded) return <TableSkeleton columns={columns.length - 1} />
  if (!query.data.items.length) return <>{empty}</>
  return (
    <>
      <DataTable
        label={label}
        columns={columns}
        rows={query.data.items}
        rowKey={rowKey}
        busy={query.loading}
      />
      <Pagination
        page={page}
        pages={pages}
        onChange={onPageChange}
        label={countLabel(total)}
      />
    </>
  )
}
