const TIME_ZONE = "America/Sao_Paulo"

const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: TIME_ZONE,
})
const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TIME_ZONE,
})
const timeFormat = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TIME_ZONE,
})
const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
})
const integer = new Intl.NumberFormat("pt-BR")
const percent = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 1,
})

export const formatDate = (value: string | null | undefined) =>
  value ? dateFormat.format(new Date(value)) : "—"
export const formatDateTime = (value: string | null | undefined) =>
  value ? dateTimeFormat.format(new Date(value)) : "—"
export const formatTime = (value: string) => timeFormat.format(new Date(value))
export const formatMoney = (cents: number) => money.format(cents / 100)
export const formatNumber = (value: number) => integer.format(value)
/** Sem base de cálculo não existe percentual: nunca vira 0%. */
export const formatRate = (value: number | null) =>
  value === null ? "Sem dados" : percent.format(value)
export const formatShare = (part: number, whole: number) =>
  whole > 0 ? percent.format(part / whole) : "—"

/** "2026-11-04" vira "04/11". A data já vem no fuso do campus, não converter de novo. */
export const formatDayLabel = (isoDate: string) => {
  const [, month, day] = isoDate.split("-")
  return `${day}/${month}`
}

/** "1 denúncia", "2 denúncias". */
export const countOf = (value: number, singular: string, plural: string) =>
  `${formatNumber(value)} ${value === 1 ? singular : plural}`

export const shortId = (id: string) => id.slice(0, 8).toUpperCase()

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? "?"
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ""
  return `${first}${last}`.toUpperCase()
}
