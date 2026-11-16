import { type RefObject, useEffect } from "react"

/**
 * Fecha um popover com Esc, clique fora ou foco saindo dele. No Esc o foco volta ao botão
 * que o abriu, que precisa ser o primeiro botão do contêiner.
 */
export function useDismiss(
  container: RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return
    const outside = (target: EventTarget | null) =>
      target instanceof Node && !container.current?.contains(target)
    const onPointer = (event: PointerEvent) => {
      if (outside(event.target)) close()
    }
    const onFocus = (event: FocusEvent) => {
      if (outside(event.target)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      close()
      container.current?.querySelector("button")?.focus()
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("focusin", onFocus)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("focusin", onFocus)
      document.removeEventListener("keydown", onKey)
    }
  }, [container, open, close])
}
