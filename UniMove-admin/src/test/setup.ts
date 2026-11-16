import { cleanup, configure } from "@testing-library/react"
import { afterEach } from "vitest"

// As páginas são carregadas sob demanda, e a primeira importação do Recharts é lenta.
configure({ asyncUtilTimeout: 15000 })

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as typeof ResizeObserver
// O jsdom não implementa rolagem e reclama no console a cada troca de tela.
window.scrollTo = () => {}

afterEach(() => {
  cleanup()
  window.history.pushState(null, "", "/")
  document.cookie = "uc_admin_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT"
  window.localStorage.clear()
})
