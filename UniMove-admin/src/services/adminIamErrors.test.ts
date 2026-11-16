import { describe, expect, it } from "vitest"
import { ApiError } from "./http"
import {
  IAM_ERROR_HINTS,
  iamErrorHint,
  iamErrorMessage,
  isStaleStateError,
} from "./adminIamErrors"

const error = (code: string, message = "mensagem do servidor", status = 409) =>
  new ApiError(message, status, code)

describe("tratamento padronizado dos erros de gestão de acesso", () => {
  it("código reutilizado manda esperar o próximo, não conferir a senha", () => {
    const hint = iamErrorHint(error("ADMIN_REAUTH_CODE_ALREADY_USED", "qualquer", 401))
    expect(hint?.field).toBe("twoFactorCode")
    expect(hint?.recoverable).toBe(true)
    expect(iamErrorMessage(error("ADMIN_REAUTH_CODE_ALREADY_USED"))).toMatch(
      /aguarde o próximo código/i,
    )
  })

  it("ticket MFA já usado pede reinício da configuração", () => {
    const hint = iamErrorHint(error("ADMIN_FACTOR_SETUP_STALE"))
    expect(hint).toMatchObject({ recoverable: false, stale: true })
    expect(iamErrorMessage(error("ADMIN_FACTOR_SETUP_STALE"))).toMatch(/comece novamente/i)
  })

  it("senha ou código errados apontam o campo da senha e permitem tentar de novo", () => {
    expect(iamErrorHint(error("ADMIN_REAUTH_FAILED"))).toMatchObject({
      field: "password",
      recoverable: true,
    })
  })

  it("conflito de concorrência é marcado para a tela recarregar a lista", () => {
    expect(isStaleStateError(error("ADMIN_INVITE_NOT_PENDING"))).toBe(true)
    expect(isStaleStateError(error("PERMISSIONS_UNCHANGED"))).toBe(true)
    expect(isStaleStateError(error("NOT_AN_ADMIN"))).toBe(true)
    expect(isStaleStateError(error("LAST_ADMIN_MANAGER"))).toBe(false)
  })

  it("bloqueio de invariante não é recuperável no formulário", () => {
    for (const code of ["LAST_ADMIN", "LAST_ADMIN_MANAGER", "CANNOT_REVOKE_OWN_ACCESS"])
      expect(iamErrorHint(error(code))?.recoverable).toBe(false)
  })

  it("quando não há dica, vale a mensagem que o servidor mandou", () => {
    expect(iamErrorMessage(error("CODIGO_DESCONHECIDO", "Mensagem específica."))).toBe(
      "Mensagem específica.",
    )
    expect(iamErrorHint(error("CODIGO_DESCONHECIDO"))).toBeUndefined()
  })

  it("erro que não é da API tem texto genérico, sem vazar detalhe interno", () => {
    expect(iamErrorMessage(new Error("TypeError: undefined is not a function"))).toBe(
      "Não foi possível concluir a operação. Tente novamente.",
    )
    expect(iamErrorHint(new Error("x"))).toBeUndefined()
  })

  it("toda dica com texto aponta uma ação, e nenhuma expõe token ou segredo", () => {
    for (const [code, hint] of Object.entries(IAM_ERROR_HINTS)) {
      if (hint.message) expect(hint.message.length, code).toBeGreaterThan(15)
      expect(JSON.stringify(hint), code).not.toMatch(/token=|secret|segredo/i)
    }
  })
})
