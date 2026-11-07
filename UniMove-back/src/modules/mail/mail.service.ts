import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';

export type MailDelivery = 'SENT' | 'NOT_CONFIGURED' | 'FAILED';

export interface MailMessage {
  to: string;
  subject: string;
  /** Corpo em texto puro. Pode conter token: nunca vai para log. */
  text: string;
  html: string;
}

export type MailProvider = 'smtp' | 'log' | 'none';

/**
 * Envio transacional de segurança. Separado de NotificationService de propósito:
 * aquele atende o aplicativo, respeita preferências e horário de silêncio do
 * usuário; este não pode ser silenciado por preferência alguma e precisa alcançar
 * quem ainda não tem conta (convite).
 *
 * O corpo da mensagem carrega token de uso único; por isso só o destinatário
 * mascarado e o assunto chegam ao log. `send` nunca lança: a falha volta como
 * `FAILED` para quem chamou decidir o que dizer ao administrador.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  provider(): MailProvider {
    const configured = this.config.get<MailProvider>('mail.provider');
    if (configured) return configured;
    return this.smtpConfigured() ? 'smtp' : 'log';
  }

  async send(message: MailMessage): Promise<MailDelivery> {
    const provider = this.provider();
    if (provider === 'none') return 'NOT_CONFIGURED';
    if (provider === 'log') {
      this.logger.warn(
        `E-mail não enviado (sem provedor configurado): "${message.subject}" para ${maskEmail(message.to)}`,
      );
      return 'NOT_CONFIGURED';
    }
    if (!this.smtpConfigured()) return 'NOT_CONFIGURED';
    try {
      const transport = nodemailer.createTransport({
        host: this.config.getOrThrow<string>('mail.smtp.host'),
        port: this.config.get<number>('mail.smtp.port') ?? 587,
        secure: this.config.get<boolean>('mail.smtp.secure') === true,
        auth: {
          user: this.config.getOrThrow<string>('mail.smtp.user'),
          pass: this.config.getOrThrow<string>('mail.smtp.pass'),
        },
      });
      await transport.sendMail({
        from: this.config.get<string>('mail.from') ?? this.config.get<string>('mail.smtp.user'),
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return 'SENT';
    } catch {
      // A exceção do transporte pode conter credencial ou o próprio corpo.
      this.logger.error(
        `Falha ao enviar "${message.subject}" para ${maskEmail(message.to)}. Verifique o provedor SMTP.`,
      );
      return 'FAILED';
    }
  }

  private smtpConfigured() {
    const smtp = this.config.get<{ host?: string; user?: string; pass?: string }>('mail.smtp');
    return Boolean(smtp?.host && smtp.user && smtp.pass);
  }
}

/** `joao.silva@ucb.edu.br` fica `jo***va@ucb.edu.br`: identifica sem publicar. */
export function maskEmail(email: string) {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const head = local.slice(0, 2);
  const tail = local.length > 4 ? local.slice(-2) : '';
  return `${head}***${tail}@${domain}`;
}
