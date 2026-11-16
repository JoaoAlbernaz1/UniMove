import { type ReactNode, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  History,
  Inbox,
  LoaderCircle,
  RefreshCw,
  Route,
  Search,
  X,
} from "lucide-react"
import { ApiError } from "../services/http"
import { useModalFocus } from "../hooks/useModalFocus"

export type StatusTone = "green" | "amber" | "red" | "blue" | "gray"

export const cn = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ")

export function BrandIdentity() {
  return (
    <>
      <div className="brand-mark">
        <Route size={16} aria-hidden="true" />
      </div>
      <div className="brand-name">
        <strong>UniCarona</strong>
        <span>Admin</span>
      </div>
    </>
  )
}

export function Avatar({
  initials,
  size = "md",
}: {
  initials: string
  size?: "sm" | "md" | "lg"
}) {
  return (
    <span className={cn("avatar", `avatar-${size}`)} aria-hidden="true">
      {initials}
    </span>
  )
}

const toneMap: Record<string, StatusTone> = {
  Ativa: "green",
  Aprovada: "green",
  Concluída: "green",
  Resolvida: "green",
  Confirmada: "green",
  Aceita: "green",
  Pendente: "amber",
  Agendada: "amber",
  Suspensa: "amber",
  "Não compareceu": "amber",
  Aberta: "blue",
  "Em andamento": "blue",
  "Em análise": "blue",
  Motorista: "blue",
  Administrador: "blue",
  Rejeitada: "red",
  Bloqueada: "red",
  Cancelada: "red",
  Recusada: "red",
  Excluída: "gray",
  Arquivada: "gray",
  Expirada: "gray",
  Passageiro: "gray",
}

export function Badge({
  children,
  tone,
}: {
  children: ReactNode
  tone?: StatusTone
}) {
  const label = String(children)
  return (
    <span className={cn("badge", `badge-${tone || toneMap[label] || "gray"}`)}>
      {children}
    </span>
  )
}

export function Button({
  children,
  variant = "primary",
  size,
  className,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger"
  size?: "small"
}) {
  return (
    <button
      type={type}
      className={cn(
        "button",
        `button-${variant}`,
        size && `button-${size}`,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Buscar...",
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="search-input">
      <Search size={15} aria-hidden="true" />
      <input
        type="search"
        name="busca"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </label>
  )
}

export function Select({
  value,
  onChange,
  children,
  ariaLabel,
  highlightActive = true,
  className,
}: {
  value: string
  onChange: (value: string) => void
  children: ReactNode
  ariaLabel: string
  /** Destaca o campo quando um filtro está aplicado. Desligar em opções que sempre têm valor. */
  highlightActive?: boolean
  className?: string
}) {
  return (
    <span className={cn("select-wrap", className)}>
      <select
        className="select"
        name={ariaLabel}
        value={value}
        data-active={highlightActive && value !== ""}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
      >
        {children}
      </select>
      <ChevronDown size={14} aria-hidden="true" />
    </span>
  )
}

export function PageIntro({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="page-intro">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="page-intro-action">{action}</div>}
    </div>
  )
}

/** Filtros aplicados pedem outra saída que uma lista realmente vazia: limpar, não esperar. */
export function EmptyState({
  title = "Nenhum resultado encontrado",
  description,
  filtered = false,
  onClear,
  compact = false,
}: {
  title?: string
  description?: string
  filtered?: boolean
  onClear?: () => void
  compact?: boolean
}) {
  const text =
    description ??
    (filtered
      ? "Altere ou limpe os filtros para ver mais registros."
      : "Os registros aparecem aqui assim que existirem.")
  return (
    <div className={cn("state-block", compact && "state-block-compact")}>
      {!compact && (
        <div className="state-icon">
          {filtered ? <Search size={18} /> : <Inbox size={18} />}
        </div>
      )}
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {filtered && onClear && (
        <Button variant="secondary" className="state-action" onClick={onClear}>
          Limpar filtros
        </Button>
      )}
    </div>
  )
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: ApiError
  onRetry?: () => void
}) {
  return (
    <div className="state-block" role="alert">
      <div className="state-icon state-icon-error">
        <AlertTriangle size={18} />
      </div>
      <strong>Não foi possível carregar</strong>
      <p>{error.message}</p>
      {onRetry && (
        <Button variant="secondary" className="state-action" onClick={onRetry}>
          <RefreshCw size={14} /> Tentar novamente
        </Button>
      )}
    </div>
  )
}

export function Pagination({
  page,
  pages,
  onChange,
  label,
}: {
  page: number
  pages: number
  onChange: (page: number) => void
  label: string
}) {
  return (
    <div className="pagination">
      <span>{label}</span>
      {pages > 1 && (
        <nav aria-label="Paginação">
          <div>
            <button
              type="button"
              className="icon-button"
              disabled={page <= 1}
              onClick={() => onChange(page - 1)}
              aria-label="Página anterior"
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              Página {page} de {pages}
            </span>
            <button
              type="button"
              className="icon-button"
              disabled={page >= pages}
              onClick={() => onChange(page + 1)}
              aria-label="Próxima página"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </nav>
      )}
    </div>
  )
}

export function Modal({
  title,
  description,
  onClose,
  children,
  width = "md",
  dismissible = true,
  closeOnBackdrop = true,
}: {
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  width?: "md" | "lg"
  dismissible?: boolean
  /** Desligar quando houver texto digitado: um clique fora não pode descartar o que foi escrito. */
  closeOnBackdrop?: boolean
}) {
  const dialog = useRef<HTMLElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  useModalFocus(dialog, layer, onClose, dismissible)
  return createPortal(
    <div
      ref={layer}
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) =>
        dismissible &&
        closeOnBackdrop &&
        e.target === e.currentTarget &&
        onClose()
      }
    >
      <section
        ref={dialog}
        tabIndex={-1}
        className={cn("modal", width === "lg" && "modal-lg")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <header>
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Fechar"
            disabled={!dismissible}
          >
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  )
}

/** Campo de justificativa: mostra o que falta antes de habilitar a decisão. */
export function ReasonField({
  label,
  value,
  onChange,
  minLength = 1,
  maxLength,
  placeholder,
  autoFocus = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  minLength?: number
  maxLength: number
  placeholder?: string
  autoFocus?: boolean
}) {
  const hintId = useId()
  const length = value.trim().length
  return (
    <div className="reason-field">
      <label className="field">
        <span>{label}</span>
        <textarea
          name="justificativa"
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-describedby={hintId}
          data-autofocus={autoFocus || undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      <div className="field-hint" id={hintId}>
        <span>
          {minLength > 1 && length < minLength
            ? `Mínimo de ${minLength} caracteres.`
            : ""}
        </span>
        <span>
          {value.length} de {maxLength}
        </span>
      </div>
    </div>
  )
}

/**
 * A ação só termina quando o backend confirma: o modal fica aberto até lá, e o
 * erro da API aparece aqui, sem perder o motivo digitado.
 */
export function ConfirmModal({
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
  destructive = false,
  requireReason = false,
  reasonLabel = "Motivo obrigatório",
  reasonMinLength = 1,
  confirmDisabled = false,
  children,
}: {
  title: string
  description: string
  confirmLabel: string
  onConfirm: (reason: string) => Promise<void>
  onClose: () => void
  destructive?: boolean
  requireReason?: boolean
  reasonLabel?: string
  reasonMinLength?: number
  /** O impedimento já está explicado no conteúdo do modal. */
  confirmDisabled?: boolean
  children?: ReactNode
}) {
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const reasonMissing = requireReason && reason.trim().length < reasonMinLength

  async function confirm() {
    if (reasonMissing || busy || confirmDisabled) return
    setBusy(true)
    setError(undefined)
    try {
      await onConfirm(reason.trim())
    } catch (reasonError) {
      setError(
        reasonError instanceof Error
          ? reasonError.message
          : "Não foi possível concluir a operação.",
      )
      setBusy(false)
    }
  }

  return (
    <Modal
      title={title}
      description={description}
      onClose={onClose}
      dismissible={!busy}
      closeOnBackdrop={!reason}
    >
      <div className="modal-body">
        {children}
        {requireReason && (
          <ReasonField
            label={reasonLabel}
            value={reason}
            onChange={setReason}
            minLength={reasonMinLength}
            maxLength={500}
            placeholder="Descreva de forma objetiva o motivo desta decisão."
            autoFocus
          />
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <p className="quiet-note">
          <History size={14} aria-hidden="true" />
          <span>Esta ação fica registrada na auditoria.</span>
        </p>
      </div>
      <footer className="modal-footer">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button
          variant={destructive ? "danger" : "primary"}
          onClick={() => void confirm()}
          disabled={busy || reasonMissing || confirmDisabled}
          aria-busy={busy}
        >
          {busy && <LoaderCircle size={14} className="spin" aria-hidden="true" />}
          {busy ? "Processando..." : confirmLabel}
        </Button>
      </footer>
    </Modal>
  )
}

export function Toast({
  message,
  type = "success",
  onClose,
}: {
  message: string
  type?: "success" | "error"
  onClose: () => void
}) {
  return (
    <div
      className={cn("toast", type === "error" && "toast-error")}
      role={type === "error" ? "alert" : "status"}
    >
      {type === "success" ? <Check size={16} /> : <AlertTriangle size={16} />}
      <span>{message}</span>
      <button type="button" onClick={onClose} aria-label="Fechar aviso">
        <X size={14} />
      </button>
    </div>
  )
}

export function Loading({ label = "Carregando dados..." }: { label?: string }) {
  return (
    <div className="state-loading" role="status">
      <LoaderCircle size={18} className="spin" aria-hidden="true" /> {label}
    </div>
  )
}

/** Reserva o espaço da tabela, para a página não pular quando os dados chegam. */
export function TableSkeleton({ columns = 3 }: { columns?: number }) {
  return (
    <div className="skeleton-table" role="status" aria-label="Carregando dados">
      {Array.from({ length: 6 }, (_, row) => (
        <div
          className="skeleton-row"
          key={row}
          style={{ "--skeleton-columns": columns } as React.CSSProperties}
        >
          {Array.from({ length: columns + 1 }, (_, column) => (
            <span className="skeleton" key={column} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Trajeto com a linha entre origem e destino. Vai dentro de um elemento com a classe "route". */
export function RouteStops({
  origin,
  destination,
}: {
  origin: string
  destination: string
}) {
  return (
    <>
      <span className="route-stop">
        <span className="sr-only">Origem: </span>
        {origin}
      </span>
      <span className="route-stop">
        <span className="sr-only">Destino: </span>
        {destination}
      </span>
    </>
  )
}

export type StatusOption = { value: string; label: string; count?: number }

/** Situações com contagem: cada uma é também o atalho para filtrar a lista por ela. */
export function StatusFilter({
  label,
  options,
  value,
  onChange,
  loaded,
}: {
  label: string
  options: StatusOption[]
  value: string
  onChange: (value: string) => void
  loaded: boolean
}) {
  return (
    <div className="status-filter" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && (
            <b>{loaded ? option.count.toLocaleString("pt-BR") : "—"}</b>
          )}
        </button>
      ))}
    </div>
  )
}
