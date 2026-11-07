import type { MailMessage } from './mail.service';

const BRAND = 'UniMove Admin';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Um layout só para todo e-mail de segurança do painel: tabela e estilo em linha,
 * porque cliente de e-mail ignora folha de estilo externa. Sem imagem remota,
 * para não vazar abertura nem depender de carregamento.
 */
function layout(options: {
  title: string;
  lead: string;
  action?: { label: string; url: string };
  details?: string[];
  footer: string;
}) {
  const detailItems = (options.details ?? [])
    .map(
      (item) =>
        `<li style="margin:0 0 6px;color:#344054;font-size:14px;line-height:1.6">${escapeHtml(item)}</li>`,
    )
    .join('');
  const action = options.action
    ? `<p style="margin:0 0 24px">
         <a href="${options.action.url}" style="display:inline-block;background:#101828;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">${escapeHtml(options.action.label)}</a>
       </p>
       <p style="margin:0 0 24px;color:#667085;font-size:12px;line-height:1.6;word-break:break-all">
         Se o botão não funcionar, copie este endereço no navegador:<br>${escapeHtml(options.action.url)}
       </p>`
    : '';
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(options.title)}</title></head>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e7ec;border-radius:12px;border-collapse:collapse">
        <tr><td style="padding:28px 28px 0">
          <p style="margin:0 0 24px;font-size:13px;font-weight:600;letter-spacing:0.02em;color:#101828;text-transform:uppercase">${BRAND}</p>
          <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#101828">${escapeHtml(options.title)}</h1>
          <p style="margin:0 0 20px;color:#344054;font-size:14px;line-height:1.6">${escapeHtml(options.lead)}</p>
          ${detailItems ? `<ul style="margin:0 0 24px;padding-left:20px">${detailItems}</ul>` : ''}
          ${action}
        </td></tr>
        <tr><td style="padding:0 28px 28px">
          <p style="margin:0;padding-top:20px;border-top:1px solid #f2f4f7;color:#667085;font-size:12px;line-height:1.6">${escapeHtml(options.footer)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function text(lines: string[]) {
  return `${BRAND}\n\n${lines.filter(Boolean).join('\n\n')}\n`;
}

export function adminInviteEmail(input: {
  to: string;
  fullName: string;
  invitedBy: string;
  url: string;
  expiresAt: Date;
  permissions: string[];
}): MailMessage {
  const prazo = formatDateTime(input.expiresAt);
  const details = [
    `Convite emitido por ${input.invitedBy}.`,
    `Permissões concedidas: ${input.permissions.join(', ') || 'nenhuma'}.`,
    `O convite vale até ${prazo} e pode ser usado uma única vez.`,
  ];
  return {
    to: input.to,
    subject: 'Convite para o painel administrativo do UniMove',
    html: layout({
      title: `Olá, ${input.fullName}`,
      lead: 'Você foi convidado para administrar a plataforma UniMove. Para concluir o acesso, defina sua senha e configure o aplicativo autenticador. Os dois passos são obrigatórios.',
      action: { label: 'Aceitar convite', url: input.url },
      details,
      footer:
        'Se você não esperava este convite, ignore esta mensagem e avise a equipe responsável. Nenhum acesso é concedido sem a conclusão dos dois passos.',
    }),
    text: text([
      `Olá, ${input.fullName}.`,
      'Você foi convidado para administrar a plataforma UniMove. Para concluir o acesso, defina sua senha e configure o aplicativo autenticador. Os dois passos são obrigatórios.',
      ...details,
      `Aceitar convite: ${input.url}`,
      'Se você não esperava este convite, ignore esta mensagem e avise a equipe responsável.',
    ]),
  };
}

export function adminPasswordResetEmail(input: {
  to: string;
  fullName: string;
  url: string;
  expiresAt: Date;
}): MailMessage {
  const prazo = formatDateTime(input.expiresAt);
  return {
    to: input.to,
    subject: 'Redefinição de senha administrativa do UniMove',
    html: layout({
      title: 'Redefinir sua senha',
      lead: `Recebemos um pedido para redefinir a senha da sua conta administrativa. O link abaixo vale até ${prazo} e pode ser usado uma única vez.`,
      action: { label: 'Definir nova senha', url: input.url },
      details: [
        'A autenticação em duas etapas continua obrigatória depois da troca.',
        'Todas as sessões abertas serão encerradas quando a senha mudar.',
      ],
      footer:
        'Se não foi você quem pediu, ignore esta mensagem: a senha atual continua valendo. Em caso de dúvida, avise a equipe de segurança.',
    }),
    text: text([
      `Olá, ${input.fullName}.`,
      `Recebemos um pedido para redefinir a senha da sua conta administrativa. O link vale até ${prazo} e pode ser usado uma única vez.`,
      `Definir nova senha: ${input.url}`,
      'A autenticação em duas etapas continua obrigatória e todas as sessões abertas serão encerradas.',
      'Se não foi você quem pediu, ignore esta mensagem.',
    ]),
  };
}

export function adminPasswordChangedEmail(input: {
  to: string;
  fullName: string;
  changedAt: Date;
}): MailMessage {
  const quando = formatDateTime(input.changedAt);
  return {
    to: input.to,
    subject: 'Sua senha administrativa do UniMove foi alterada',
    html: layout({
      title: 'Senha alterada',
      lead: `A senha da sua conta administrativa foi alterada em ${quando}. Todas as sessões abertas foram encerradas.`,
      details: ['A autenticação em duas etapas permanece ativa e continua obrigatória.'],
      footer:
        'Se não foi você, procure imediatamente outro administrador para suspender o acesso desta conta.',
    }),
    text: text([
      `Olá, ${input.fullName}.`,
      `A senha da sua conta administrativa foi alterada em ${quando}. Todas as sessões abertas foram encerradas.`,
      'A autenticação em duas etapas permanece ativa e continua obrigatória.',
      'Se não foi você, procure imediatamente outro administrador para suspender o acesso desta conta.',
    ]),
  };
}

export function adminMfaRecoveryRequestedEmail(input: {
  to: string;
  reviewerName: string;
  subjectName: string;
  subjectEmail: string;
  reason: string;
  url: string;
}): MailMessage {
  return {
    to: input.to,
    subject: 'Pedido de recuperação de segundo fator aguardando aprovação',
    html: layout({
      title: 'Há um pedido para revisar',
      lead: `${input.subjectName} (${input.subjectEmail}) pediu a recuperação do segundo fator e precisa da aprovação de um administrador autorizado.`,
      action: { label: 'Revisar pedido no painel', url: input.url },
      details: [
        `Motivo informado: ${input.reason}`,
        'Confirme a identidade por um canal confiável antes de aprovar.',
        'Aprovar invalida o autenticador atual e encerra as sessões da conta.',
      ],
      footer:
        'A aprovação exige sua senha e um código do seu próprio autenticador. Ninguém pode aprovar o próprio pedido.',
    }),
    text: text([
      `Olá, ${input.reviewerName}.`,
      `${input.subjectName} (${input.subjectEmail}) pediu a recuperação do segundo fator e precisa da aprovação de um administrador autorizado.`,
      `Motivo informado: ${input.reason}`,
      `Revisar pedido: ${input.url}`,
      'Confirme a identidade por um canal confiável antes de aprovar. A aprovação exige sua senha e um código do seu próprio autenticador.',
    ]),
  };
}

export function adminMfaRecoveryApprovedEmail(input: {
  to: string;
  fullName: string;
  url: string;
  expiresAt: Date;
  reviewedBy: string;
}): MailMessage {
  const prazo = formatDateTime(input.expiresAt);
  return {
    to: input.to,
    subject: 'Recuperação de segundo fator aprovada',
    html: layout({
      title: 'Pedido aprovado',
      lead: `${input.reviewedBy} aprovou a recuperação do seu segundo fator. Use o link abaixo até ${prazo} para cadastrar um novo autenticador.`,
      action: { label: 'Cadastrar novo autenticador', url: input.url },
      details: [
        'Sua senha será pedida novamente: o link sozinho não desativa o segundo fator.',
        'O autenticador anterior e os códigos de recuperação antigos deixam de valer.',
      ],
      footer: 'O link vale uma única vez. Se não foi você quem pediu, avise a equipe de segurança.',
    }),
    text: text([
      `Olá, ${input.fullName}.`,
      `${input.reviewedBy} aprovou a recuperação do seu segundo fator. Use o link até ${prazo} para cadastrar um novo autenticador.`,
      `Cadastrar novo autenticador: ${input.url}`,
      'Sua senha será pedida novamente: o link sozinho não desativa o segundo fator. O autenticador anterior e os códigos antigos deixam de valer.',
    ]),
  };
}

export function adminMfaRecoveryRejectedEmail(input: {
  to: string;
  fullName: string;
  reviewedBy: string;
  note?: string;
}): MailMessage {
  const details = input.note ? [`Observação do revisor: ${input.note}`] : [];
  return {
    to: input.to,
    subject: 'Recuperação de segundo fator recusada',
    html: layout({
      title: 'Pedido recusado',
      lead: `${input.reviewedBy} recusou o seu pedido de recuperação do segundo fator. Seu autenticador atual continua valendo.`,
      details,
      footer: 'Procure a equipe responsável pelo canal interno se precisar abrir um novo pedido.',
    }),
    text: text([
      `Olá, ${input.fullName}.`,
      `${input.reviewedBy} recusou o seu pedido de recuperação do segundo fator. Seu autenticador atual continua valendo.`,
      ...details,
    ]),
  };
}

export function adminAccessRevokedEmail(input: {
  to: string;
  fullName: string;
  revokedBy: string;
}): MailMessage {
  return {
    to: input.to,
    subject: 'Seu acesso administrativo ao UniMove foi encerrado',
    html: layout({
      title: 'Acesso administrativo encerrado',
      lead: `${input.revokedBy} encerrou o seu acesso ao painel administrativo do UniMove. As sessões abertas foram encerradas.`,
      details: ['Sua conta de usuário da plataforma não foi excluída.'],
      footer: 'Em caso de dúvida, procure a equipe responsável pelo canal interno.',
    }),
    text: text([
      `Olá, ${input.fullName}.`,
      `${input.revokedBy} encerrou o seu acesso ao painel administrativo do UniMove. As sessões abertas foram encerradas.`,
      'Sua conta de usuário da plataforma não foi excluída.',
    ]),
  };
}

/** Horário de Brasília, como o resto do painel apresenta datas. */
function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(value);
}
