import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { formatDayLabel, formatNumber } from "../lib/format"
import type { SeriesPoint } from "../types/api"
import { cn } from "./ui"

const GRID = "#f2f4f7"
const CURSOR = "#d0d5dd"
const RIDE_LINE = "#16a34a"
const SIGNUP_BAR = "#101828"

function TooltipCard({
  active,
  payload,
  label,
  seriesName,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ value?: unknown }>
  label?: unknown
  seriesName: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <strong>{String(label ?? "")}</strong>
      <span>
        {seriesName}: {formatNumber(Number(payload[0].value ?? 0))}
      </span>
    </div>
  )
}

/** Um indicador ao longo dos dias. A tabela oculta entrega os mesmos dados a leitores de tela. */
export function TrendChart({
  series,
  metric,
  size = "medium",
}: {
  series: SeriesPoint[]
  metric: "rides" | "users"
  size?: "small" | "medium" | "large"
}) {
  const seriesName = metric === "rides" ? "Caronas" : "Cadastros"
  const data = series.map((point) => ({
    name: formatDayLabel(point.date),
    value: point[metric],
  }))
  const axes = (
    <>
      <CartesianGrid stroke={GRID} vertical={false} />
      <XAxis
        dataKey="name"
        axisLine={false}
        tickLine={false}
        tickMargin={8}
        minTickGap={24}
        interval="preserveStartEnd"
      />
      <YAxis
        allowDecimals={false}
        axisLine={false}
        tickLine={false}
        width={36}
      />
    </>
  )
  return (
    <figure className="chart-frame">
      <div
        className={cn(
          "chart-wrap",
          size === "small" && "chart-wrap-small",
          size === "large" && "chart-wrap-large",
        )}
      >
        <ResponsiveContainer width="100%" height="100%">
          {metric === "rides" ? (
            <AreaChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              {axes}
              <Tooltip
                cursor={{ stroke: CURSOR }}
                content={<TooltipCard seriesName={seriesName} />}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={RIDE_LINE}
                strokeWidth={2}
                fill={RIDE_LINE}
                fillOpacity={0.08}
                activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </AreaChart>
          ) : (
            <BarChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              {axes}
              <Tooltip
                cursor={{ fill: GRID }}
                content={<TooltipCard seriesName={seriesName} />}
              />
              <Bar
                dataKey="value"
                fill={SIGNUP_BAR}
                radius={[4, 4, 0, 0]}
                maxBarSize={24}
                isAnimationActive={false}
              />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {/* A classe fica no contêiner: tabela ignora largura e overflow e alargaria a página. */}
      <div className="sr-only">
        <table>
          <caption>{seriesName} por dia</caption>
          <thead>
            <tr>
              <th scope="col">Dia</th>
              <th scope="col">{seriesName}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((point) => (
              <tr key={point.name}>
                <td>{point.name}</td>
                <td>{point.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}
