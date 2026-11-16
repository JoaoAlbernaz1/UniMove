// Sempre a própria origem do painel: em produção o rewrite do vercel.json leva à API,
// em desenvolvimento o proxy do Vite. É o que mantém os cookies de sessão em primeira parte.
export const API_BASE_PATH = "/api/v1"

// Mesmo portal usado pelo app móvel. O PDF não é guardado depois do processamento:
// a conferência é feita pelo GUID, digitado no validador.
export const TOTVS_VALIDATOR_URL =
  "https://portalacademico.ubec.edu.br/Corpore.Net/Source/Rpt-GeradorRelatoriosNet/RM.Rpt.Reports/Anonymous/RptFindReportByGuid.aspx"

export const PAGE_SIZE = 20
