import { formatNumber, formatShare } from "../lib/format"

export const PERIODS = [7, 30, 90]

export function PeriodFilter({
  value,
  onChange,
}: {
  value: number
  onChange: (days: number) => void
}) {
  return (
    <div className="period-filter" role="group" aria-label="Filtro de período">
      {PERIODS.map((days) => (
        <button
          type="button"
          key={days}
          aria-pressed={value === days}
          onClick={() => onChange(days)}
        >
          {days} dias
        </button>
      ))}
    </div>
  )
}

export type Segment = { name: string; value: number; color: string }

/** Uma parte do todo por cor, sempre acompanhada de nome, número e percentual. */
export function SegmentChart({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((sum, item) => sum + item.value, 0)
  return (
    <div className="segment-chart">
      <div className="segment-bar" aria-hidden="true">
        {segments
          .filter((item) => item.value > 0)
          .map((item) => (
            <i
              key={item.name}
              title={`${item.name}: ${formatNumber(item.value)}`}
              style={{ flexGrow: item.value, background: item.color }}
            />
          ))}
      </div>
      <dl className="segment-legend">
        {segments.map((item) => (
          <div key={item.name}>
            <dt>
              <i style={{ background: item.color }} aria-hidden="true" />
              {item.name}
            </dt>
            <dd>
              {formatNumber(item.value)}
              <span>{formatShare(item.value, total)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export type Meter = {
  key: string
  label: string
  value: number
  /** Comprimento da barra, de 0 a 100. */
  percent: number
  share?: string
  color?: string
}

export function MeterList({ items }: { items: Meter[] }) {
  return (
    <div className="meter-list">
      {items.map((item) => (
        <div className="meter-row" key={item.key}>
          <span>{item.label}</span>
          <strong>
            {formatNumber(item.value)}
            {item.share && <small>{item.share}</small>}
          </strong>
          <div className="meter-track" aria-hidden="true">
            <b style={{ width: `${item.percent}%`, background: item.color }} />
          </div>
        </div>
      ))}
    </div>
  )
}
