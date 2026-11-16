import { ApiError } from "./http"

/**
 * Tradução dos códigos de erro das rotas de gestão de acesso.
 *
 * A API já devolve `message` em português e a tela deve mostrá-la. Este mapa
 * existe para os casos em que a tela precisa dizer mais do que o servidor pode:
 * sugerir a ação certa, apontar o campo culpado ou evitar que um estado de
 * concorrência pareça erro de digitação.
 *
 * `field` diz onde o aviso deve aparecer; `recoverable` distingue o que o
 * usuário resolve ali mesmo do que exige recomeçar o fluxo.
 */
export type IamErrorHint = {
  /** Texto a mostrar quando for mais claro que o do servidor. */
  message?: string
  /** Campo do formulário que deve receber o aviso, quando houver um. */
  field?: "email" | "password" | "currentPassword" | "twoFactorCode" | "cpf" | "permissions"
  /** O usuário consegue corrigir sem reiniciar o fluxo. */
  recoverable: boolean
  /** A tela deve recarregar a lista: outro administrador mudou o estado. */
  stale?: boolean
}

export const IAM_ERROR_HINTS: Record<string, IamErrorHint> = {
  // -------------------------------------------------------- reautenticação
  ADMIN_REAUTH_FAILED: {
    message: "Senha ou código incorretos. Confira os dois e tente de novo.",
    field: "password",
    recoverable: true,
  },
  ADMIN_REAUTH_CODE_ALREADY_USED: {
    // O autenticador mostra o mesmo número por 30 segundos. Quem acabou de
    // entrar cai aqui, e dizer "código inválido" manda conferir a senha à toa.
    message:
      "Este código já foi usado. Aguarde o próximo código do autenticador e confirme de novo.",
    field: "twoFactorCode",
    recoverable: true,
  },
  ADMIN_LOGIN_LOCKED: {
    message: "Muitas tentativas seguidas. Aguarde alguns minutos antes de tentar de novo.",
    recoverable: false,
  },
  ADMIN_PERMISSION_REQUIRED: {
    message: "Sua conta não tem permissão para esta operação. Peça a um administrador autorizado.",
    recoverable: false,
  },

  // --------------------------------------------------------------- convites
  ADMIN_INVITE_DOMAIN_REJECTED: {
    message: "Use um e-mail institucional autorizado.",
    field: "email",
    recoverable: true,
  },
  ADMIN_INVITE_ALREADY_PENDING: {
    message: "Já existe um convite em aberto para este e-mail. Revogue-o antes de emitir outro.",
    field: "email",
    recoverable: true,
    stale: true,
  },
  ADMIN_ALREADY_ACTIVE: {
    message: "Esta conta já é administradora. Ajuste as permissões em vez de convidar.",
    field: "email",
    recoverable: true,
    stale: true,
  },
  ADMIN_INVITE_NOT_PENDING: { recoverable: false, stale: true },
  ADMIN_INVITE_INVALID: {
    message:
      "Este convite não vale mais: pode ter expirado, sido usado ou revogado. Peça um novo convite.",
    recoverable: false,
  },
  ADMIN_INVITE_PASSWORD_PENDING: {
    message: "Defina a senha antes de confirmar o autenticador.",
    recoverable: false,
  },
  ADMIN_INVITE_FACTOR_MISSING: {
    message: "O cadastro do autenticador expirou. Reinicie pelo link do convite.",
    recoverable: false,
  },
  ADMIN_INVITE_FACTOR_CHANGED: {
    message: "O cadastro do autenticador mudou em outra aba. Reinicie pelo link do convite.",
    recoverable: false,
  },
  CURRENT_PASSWORD_REQUIRED: {
    message: "Já existe uma conta com este e-mail. Confirme a senha atual para continuar.",
    field: "currentPassword",
    recoverable: true,
  },
  ACCOUNT_DATA_REQUIRED: {
    message: "Informe CPF e senha para criar a conta administrativa.",
    field: "cpf",
    recoverable: true,
  },
  CPF_IN_USE: {
    message: "Este CPF já pertence a outra conta da plataforma.",
    field: "cpf",
    recoverable: true,
  },
  INVALID_CREDENTIALS: {
    message: "Senha incorreta.",
    field: "currentPassword",
    recoverable: true,
  },
  INVALID_CODE: {
    message: "Código do autenticador incorreto. Confira o número atual no aplicativo.",
    field: "twoFactorCode",
    recoverable: true,
  },

  // ---------------------------------------------------- permissões e acesso
  NOT_AN_ADMIN: { recoverable: false, stale: true },
  PERMISSIONS_UNCHANGED: {
    message: "As permissões já estão exatamente assim.",
    field: "permissions",
    recoverable: true,
    stale: true,
  },
  LAST_ADMIN: {
    message:
      "Esta é a última conta administrativa válida. Ative outra antes de encerrar o acesso desta.",
    recoverable: false,
  },
  LAST_ADMIN_MANAGER: {
    message:
      "Esta é a última conta autorizada a gerenciar acessos. Autorize outra antes de continuar.",
    recoverable: false,
  },
  CANNOT_REVOKE_OWN_ACCESS: {
    message: "Você não pode encerrar o seu próprio acesso administrativo.",
    recoverable: false,
  },
  CANNOT_CHANGE_OWN_STATUS: { recoverable: false },
  CANNOT_REVOKE_CURRENT_SESSION: {
    message: "Para encerrar esta sessão, use Sair.",
    recoverable: false,
  },

  // --------------------------------------------- senha e segundo fator
  ADMIN_TOKEN_INVALID: {
    message: "Este link não vale mais: pode ter expirado ou já ter sido usado. Solicite outro.",
    recoverable: false,
  },
  CANNOT_REVIEW_OWN_RECOVERY: {
    message: "Outro administrador autorizado precisa revisar este pedido.",
    recoverable: false,
  },
  RECOVERY_NOT_PENDING: { recoverable: false, stale: true },
  RECOVERY_EXPIRED: {
    message: "Este pedido expirou. O administrador precisa abrir outro.",
    recoverable: false,
    stale: true,
  },
  RECOVERY_FACTOR_MISSING: {
    message: "O cadastro do autenticador expirou. Reinicie pelo link recebido.",
    recoverable: false,
  },
  RECOVERY_FACTOR_CHANGED: {
    message: "O cadastro do autenticador mudou em outra aba. Reinicie pelo link recebido.",
    recoverable: false,
  },
  ADMIN_FACTOR_SETUP_EXPIRED: {
    message: "A configuração do autenticador expirou. Comece novamente.",
    recoverable: false,
  },
  ADMIN_FACTOR_SETUP_STALE: {
    message: "O autenticador foi alterado em outra tentativa. Feche esta janela e comece novamente.",
    recoverable: false,
    stale: true,
  },

  // ------------------------------------------------------------ ambiente
  ADMIN_PANEL_URL_MISSING: {
    message:
      "O envio de e-mail do painel não está configurado no servidor. Avise a equipe de infraestrutura.",
    recoverable: false,
  },
  TWO_FACTOR_KEY_MISSING: {
    message:
      "O servidor não está configurado para cadastrar segundo fator. Avise a equipe de infraestrutura.",
    recoverable: false,
  },
}

/** Dica para o erro, ou `undefined` quando a mensagem do servidor já basta. */
export function iamErrorHint(error: unknown): IamErrorHint | undefined {
  if (!(error instanceof ApiError) || !error.code) return undefined
  return IAM_ERROR_HINTS[error.code]
}

/** Texto a exibir: a dica da tela quando existe, senão o que a API disse. */
export function iamErrorMessage(error: unknown) {
  if (!(error instanceof ApiError))
    return "Não foi possível concluir a operação. Tente novamente."
  return iamErrorHint(error)?.message ?? error.message
}

/** Conflito de concorrência: a lista na tela está velha e deve ser recarregada. */
export function isStaleStateError(error: unknown) {
  return iamErrorHint(error)?.stale === true
}

/**
 * Converte qualquer falha no erro que a tela deve mostrar, já com a dica.
 *
 * Serve para repassar a mensagem certa a componentes que só sabem ler
 * `Error.message` — ConfirmModal, por exemplo, que mantém o modal aberto e
 * mostra o texto sem perder o que foi digitado.
 */
export function asDisplayError(reason: unknown) {
  return new Error(iamErrorMessage(reason))
}

/**
 * Erro para o caso em que a consulta terminou sem dado e sem motivo. Não deve
 * acontecer, mas `ErrorState` precisa de um erro e inventar texto na tela
 * seria pior do que nomear a situação.
 */
export const unavailable = () =>
  new ApiError(
    "Os dados não chegaram. Tente novamente em instantes.",
    0,
    "DATA_UNAVAILABLE",
  )
