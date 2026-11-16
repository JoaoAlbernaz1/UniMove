import { useEffect, useId, useState } from "react"
import { Button } from "./ui"

/** Dias no formato AAAA-MM-DD, como aparecem na URL. */
export type DateRange = { from?: string; to?: string }

const toIso = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** Dias completos no horário de Brasília, o mesmo utilizado nas tabelas. */
export function dayRangeToApi({ from, to }: DateRange) {
  return {
    from: from ? toIso(`${from}T00:00:00-03:00`) : undefined,
    to: to ? toIso(`${to}T23:59:59.999-03:00`) : undefined,
  }
}

export function DateRangeFilter({
  value,
  onChange,
}: {
  value: DateRange
  onChange: (range: DateRange) => void
}) {
  const [from, setFrom] = useState(value.from ?? "")
  const [to, setTo] = useState(value.to ?? "")
  const [error, setError] = useState<string>()
  const errorId = useId()

  // "Limpar filtros" e o botão voltar alteram a URL sem passar por este formulário.
  useEffect(() => {
    setFrom(value.from ?? "")
    setTo(value.to ?? "")
  }, [value.from, value.to])

  return (
    <form
      className="date-range-filter"
      aria-label="Filtrar por período"
      title="Dias completos no horário de Brasília"
      onSubmit={(event) => {
        event.preventDefault()
        if (from && to && from > to) {
          setError("A data final deve ser igual ou posterior à data inicial.")
          return
        }
        setError(undefined)
        onChange({ from: from || undefined, to: to || undefined })
      }}
    >
      <label className="field">
        <span>Data inicial</span>
        <input
          type="date"
          name="from"
          value={from}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={Boolean(error)}
          onChange={(event) => {
            setFrom(event.target.value)
            setError(undefined)
          }}
        />
      </label>
      <label className="field">
        <span>Data final</span>
        <input
          type="date"
          name="to"
          value={to}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={Boolean(error)}
          onChange={(event) => {
            setTo(event.target.value)
            setError(undefined)
          }}
        />
      </label>
      <Button type="submit" variant="secondary">
        Aplicar período
      </Button>
      {(from || to) && (
        <Button
          variant="ghost"
          onClick={() => {
            setFrom("")
            setTo("")
            setError(undefined)
            onChange({})
          }}
        >
          Limpar período
        </Button>
      )}
      {error && (
        <p id={errorId} className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
