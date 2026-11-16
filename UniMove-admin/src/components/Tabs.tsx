import type { KeyboardEvent, ReactNode } from "react"

export type TabItem = {
  id: string
  label: string
  count?: ReactNode
  disabled?: boolean
  hint?: string
}

const tabId = (panelId: string, id: string) => `${panelId}-tab-${id}`

/** Padrão de abas do WAI-ARIA: uma parada de Tab, com setas, Home e End entre as abas. */
export function Tabs({
  label,
  items,
  value,
  onChange,
  panelId,
}: {
  label: string
  items: TabItem[]
  value: string
  onChange: (id: string) => void
  panelId: string
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const enabled = items.filter((item) => !item.disabled)
    const index = enabled.findIndex((item) => item.id === value)
    const targets: Record<string, number> = {
      ArrowRight: (index + 1) % enabled.length,
      ArrowLeft: (index - 1 + enabled.length) % enabled.length,
      Home: 0,
      End: enabled.length - 1,
    }
    const target = targets[event.key]
    if (target === undefined) return
    event.preventDefault()
    const next = enabled[target]
    onChange(next.id)
    document.getElementById(tabId(panelId, next.id))?.focus()
  }

  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {items.map((item) => (
        <button
          type="button"
          role="tab"
          id={tabId(panelId, item.id)}
          key={item.id}
          aria-selected={value === item.id}
          aria-controls={value === item.id ? panelId : undefined}
          tabIndex={value === item.id ? 0 : -1}
          disabled={item.disabled}
          title={item.hint}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.count !== undefined && (
            <span className="tab-count">{item.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

export function TabPanel({
  panelId,
  active,
  children,
}: {
  panelId: string
  active: string
  children: ReactNode
}) {
  return (
    <div role="tabpanel" id={panelId} aria-labelledby={tabId(panelId, active)}>
      {children}
    </div>
  )
}
