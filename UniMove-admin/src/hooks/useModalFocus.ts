import { type RefObject, useEffect, useRef } from "react"

const layers: HTMLElement[] = []
const previousInert = new Map<HTMLElement, boolean>()
let previousOverflow = ""
let initialFocus: HTMLElement | null = null

// Um diálogo de confirmação pode abrir sobre o de detalhes. Só o superior recebe interação.
function syncLayers() {
  const active = layers.at(-1)
  if (active) {
    for (const child of document.body.children) {
      if (!(child instanceof HTMLElement)) continue
      // Avisos flutuantes continuam legíveis e fecháveis por cima de um diálogo.
      if (child.hasAttribute("data-modal-exempt")) continue
      if (!previousInert.has(child)) previousInert.set(child, child.hasAttribute("inert"))
      child.toggleAttribute("inert", child !== active)
    }
  } else {
    for (const [element, inert] of previousInert) element.toggleAttribute("inert", inert)
    previousInert.clear()
    document.body.style.overflow = previousOverflow
  }
}

export function useModalFocus(
  dialog: RefObject<HTMLElement | null>,
  layer: RefObject<HTMLDivElement | null>,
  onClose: () => void,
  dismissible: boolean,
) {
  const options = useRef({ onClose, dismissible })
  useEffect(() => { options.current = { onClose, dismissible } }, [onClose, dismissible])

  useEffect(() => {
    const element = dialog.current
    const backdrop = layer.current
    if (!element || !backdrop) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (layers.length === 0) {
      previousOverflow = document.body.style.overflow
      initialFocus = previousFocus
    }
    layers.push(backdrop)
    syncLayers()
    document.body.style.overflow = "hidden"
    const initial = element.querySelector<HTMLElement>("[data-autofocus]") ?? element
    initial.focus()

    const isActive = () => layers.at(-1) === backdrop
    const onKey = (event: KeyboardEvent) => {
      if (!isActive()) return
      if (event.key === "Escape") {
        event.preventDefault()
        if (options.current.dismissible) options.current.onClose()
      }
      if (event.key !== "Tab") return
      const focusable = [...element.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, [tabindex]',
      )].filter((item) => item.tabIndex >= 0 && !item.matches(":disabled") && !item.closest('[hidden], [inert], [aria-hidden="true"]'))
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) {
        event.preventDefault()
        element.focus()
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === element)) {
        event.preventDefault()
        first.focus()
      }
    }
    const onFocus = (event: FocusEvent) => {
      if (isActive() && event.target instanceof Node && !element.contains(event.target)) element.focus()
    }
    window.addEventListener("keydown", onKey)
    document.addEventListener("focusin", onFocus)
    return () => {
      window.removeEventListener("keydown", onKey)
      document.removeEventListener("focusin", onFocus)
      layers.splice(layers.indexOf(backdrop), 1)
      syncLayers()
      const target = layers.length === 0
        ? initialFocus?.isConnected ? initialFocus : document.getElementById("main-content")
        : previousFocus
      if (layers.length === 0) initialFocus = null
      // O conteúdo inteiro não precisa rolar: o título ficaria escondido sob a barra superior.
      if (target?.isConnected && !target.closest("[inert]"))
        target.focus({ preventScroll: target.id === "main-content" })
    }
  }, [dialog, layer])
}
