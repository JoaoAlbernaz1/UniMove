import { lazy, Suspense } from "react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ErrorBoundary } from "./ErrorBoundary"

describe("falha ao abrir uma tela", () => {
  it("arquivo de página que sumiu depois de um deploy não deixa a tela em branco", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const Gone = lazy(() => Promise.reject(new Error("Failed to fetch dynamically imported module")))
    render(
      <ErrorBoundary>
        <Suspense fallback={null}>
          <Gone />
        </Suspense>
      </ErrorBoundary>,
    )
    expect((await screen.findByRole("alert")).textContent).toContain("Não foi possível abrir")
    expect(screen.getByRole("button", { name: "Recarregar página" })).toBeTruthy()
    expect(document.body.textContent).not.toContain("dynamically imported")
  })
})
