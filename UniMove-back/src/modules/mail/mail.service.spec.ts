const sendMail = jest.fn();
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail })) },
}));

import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { adminInviteEmail, adminPasswordResetEmail } from './admin-mail.templates';
import { MailService, maskEmail } from './mail.service';

describe('MailService', () => {
  const values: Record<string, unknown> = {};
  const config = {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => values[key]),
  };
  const service = new MailService(config as unknown as ConfigService);
  const message = {
    to: 'pessoa@ucb.edu.br',
    subject: 'Assunto de teste',
    text: 'corpo com token SEGREDO-NO-CORPO',
    html: '<p>corpo com token SEGREDO-NO-CORPO</p>',
  };
  const smtp = {
    host: 'smtp.test',
    port: 587,
    secure: false,
    user: 'conta@smtp.test',
    pass: 'senha-smtp',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(values)) delete values[key];
    sendMail.mockResolvedValue({ messageId: 'ok' });
  });

  it('sem SMTP e sem provedor explícito, não envia e devolve NOT_CONFIGURED', async () => {
    await expect(service.send(message)).resolves.toBe('NOT_CONFIGURED');
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  it('provedor none não tenta enviar nem registra nada', async () => {
    values['mail.provider'] = 'none';
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await expect(service.send(message)).resolves.toBe('NOT_CONFIGURED');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('provedor log registra destinatário mascarado e assunto, nunca o corpo', async () => {
    values['mail.provider'] = 'log';
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await expect(service.send(message)).resolves.toBe('NOT_CONFIGURED');
    const logged = String(warn.mock.calls[0][0]);
    expect(logged).toContain('Assunto de teste');
    expect(logged).toContain('pe***');
    expect(logged).not.toContain('SEGREDO-NO-CORPO');
    expect(logged).not.toContain('pessoa@ucb.edu.br');
    warn.mockRestore();
  });

  it('com SMTP configurado envia e devolve SENT', async () => {
    values['mail.smtp'] = smtp;
    values['mail.smtp.host'] = smtp.host;
    values['mail.smtp.port'] = smtp.port;
    values['mail.smtp.user'] = smtp.user;
    values['mail.smtp.pass'] = smtp.pass;
    values['mail.from'] = 'UniMove <nao-responda@unimove.test>';
    await expect(service.send(message)).resolves.toBe('SENT');
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: message.to, subject: message.subject }),
    );
  });

  it('falha de envio devolve FAILED e não registra corpo nem credencial', async () => {
    values['mail.smtp'] = smtp;
    values['mail.smtp.host'] = smtp.host;
    values['mail.smtp.user'] = smtp.user;
    values['mail.smtp.pass'] = smtp.pass;
    sendMail.mockRejectedValue(new Error(`535 auth falhou para ${smtp.pass}`));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await expect(service.send(message)).resolves.toBe('FAILED');
    const logged = String(error.mock.calls[0][0]);
    expect(logged).not.toContain(smtp.pass);
    expect(logged).not.toContain('SEGREDO-NO-CORPO');
    error.mockRestore();
  });

  it('provedor smtp declarado sem credencial não tenta enviar', async () => {
    values['mail.provider'] = 'smtp';
    await expect(service.send(message)).resolves.toBe('NOT_CONFIGURED');
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe('maskEmail', () => {
  it('mantém o domínio e esconde o miolo do endereço', () => {
    expect(maskEmail('joao.silva@ucb.edu.br')).toBe('jo***va@ucb.edu.br');
    expect(maskEmail('ana@ucb.edu.br')).toBe('an***@ucb.edu.br');
    expect(maskEmail('sem-arroba')).toBe('***');
  });
});

describe('modelos de e-mail administrativos', () => {
  const url = 'https://painel.test/convite?token=TOKEN-DE-TESTE';

  it('o convite leva o link, o prazo e as permissões, em português', () => {
    const message = adminInviteEmail({
      to: 'pessoa@ucb.edu.br',
      fullName: 'Pessoa Convidada',
      invitedBy: 'Gestor',
      url,
      expiresAt: new Date('2026-11-10T12:00:00Z'),
      permissions: ['MANAGE_USERS'],
    });
    expect(message.subject).toBe('Convite para o painel administrativo do UniMove');
    expect(message.text).toContain(url);
    expect(message.html).toContain(url);
    expect(message.text).toContain('MANAGE_USERS');
    expect(message.text).toContain('10/11/2026');
  });

  it('escapa HTML vindo do nome, para o e-mail não virar injeção', () => {
    const message = adminInviteEmail({
      to: 'pessoa@ucb.edu.br',
      fullName: '<script>alert(1)</script>',
      invitedBy: 'Gestor',
      url,
      expiresAt: new Date('2026-11-10T12:00:00Z'),
      permissions: [],
    });
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
  });

  it('a redefinição de senha avisa que o segundo fator continua obrigatório', () => {
    const message = adminPasswordResetEmail({
      to: 'pessoa@ucb.edu.br',
      fullName: 'Pessoa',
      url,
      expiresAt: new Date('2026-11-07T12:00:00Z'),
    });
    expect(message.text).toContain('duas etapas continua obrigatória');
    expect(message.html).toContain('sessões abertas serão encerradas');
  });
});
