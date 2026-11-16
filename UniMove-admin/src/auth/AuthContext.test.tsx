import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { adminUser, fakeApi } from "../test/fakeApi"
import { AuthProvider, useAuth } from "./AuthContext"

const render = () =>
  renderHook(() => useAuth(), {
    wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
  })

describe("permissões na sessão do painel", () => {
  it("can() exige todas as permissões informadas", async () => {
    fakeApi({
      "GET /admin/auth/session": {
        body: { ...adminUser, permissions: ["MANAGE_USERS", "VIEW_AUDIT"] },
      },
    })
    const { result } = render()
    await waitFor(() => expect(result.current.status).toBe("authenticated"))
    expect(result.current.can("MANAGE_USERS")).toBe(true)
    expect(result.current.can("MANAGE_USERS", "VIEW_AUDIT")).toBe(true)
    expect(result.current.can("MANAGE_ADMINS")).toBe(false)
    // Uma faltando reprova o conjunto: a tela não mostra meia ação.
    expect(result.current.can("MANAGE_USERS", "MANAGE_ADMINS")).toBe(false)
    // Sem permissão pedida, nada a esconder.
    expect(result.current.can()).toBe(true)
  })

  it("conta sem linha de permissões não vê nada de gestão de acesso", async () => {
    fakeApi({
      "GET /admin/auth/session": { body: { ...adminUser, permissions: [] } },
    })
    const { result } = render()
    await waitFor(() => expect(result.current.status).toBe("authenticated"))
    expect(result.current.can("MANAGE_ADMINS")).toBe(false)
    expect(result.current.user?.permissions).toEqual([])
  })

  it("sem sessão, can() é falso: a tela não decide acesso por si", async () => {
    fakeApi({
      "GET /admin/auth/session": {
        status: 401,
        body: { message: "Token de acesso ausente." },
      },
      // 401 faz o cliente tentar renovar uma vez; recusa aqui é sessão ausente,
      // não servidor instável.
      "POST /admin/auth/refresh": { status: 401, body: {} },
    })
    const { result } = render()
    await waitFor(() => expect(result.current.status).toBe("anonymous"))
    expect(result.current.can("MANAGE_ADMINS")).toBe(false)
  })
})
