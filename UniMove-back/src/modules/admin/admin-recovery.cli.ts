import { createInterface } from 'node:readline/promises';
import type { AdminEnrollmentService } from './admin-enrollment.service';
import { runEnrollment, serveEnrollmentQr } from './admin-enrollment.cli';

/**
 * Procedimento emergencial do último administrador: quando não há outro
 * administrador com MANAGE_ADMINS para aprovar a recuperação pelo painel, o
 * operador apaga o fator atual e provisiona outro no mesmo ato.
 *
 * Não existe rota HTTP equivalente de propósito. Exige terminal privado
 * interativo, confirmação digitada e a chave dedicada de segundo fator.
 */
export async function runEmergencyRecovery(
  emailInput: string,
  service: Pick<AdminEnrollmentService, 'begin' | 'confirm' | 'resetFactor'>,
  io: {
    question(prompt: string): Promise<string>;
    showQr(dataUrl: string): Promise<() => Promise<void>>;
    showRecoveryCodes(codes: string[]): void;
    warn(message: string): void;
  },
) {
  const email = emailInput.trim().toLowerCase();
  const confirmation = await io.question(
    `Isto apaga o autenticador e os códigos de recuperação atuais de ${email} e encerra as sessões dela. ` +
      `Confirme a identidade por um canal confiável. Digite RECUPERAR ${email}: `,
  );
  if (confirmation !== `RECUPERAR ${email}`) throw new Error('Recuperação cancelada.');
  await service.resetFactor(email);
  io.warn('Fator anterior apagado. Provisione o novo autenticador agora, sem fechar o terminal.');
  await runEnrollment(email, service, io);
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('Execute em um terminal privado interativo, sem redirecionamento de saída.');
  const [email, ...extra] = process.argv.slice(2);
  if (!email || extra.length) throw new Error('Uso: npm run admin:recover-mfa -- admin@ucb.edu.br');
  const dotenv = await import('dotenv');
  dotenv.config({ quiet: true });
  if (
    !process.env.DATABASE_URL ||
    !process.env.JWT_ACCESS_SECRET ||
    !process.env.TWO_FACTOR_ENCRYPTION_KEY
  )
    throw new Error(
      'Configure DATABASE_URL, JWT_ACCESS_SECRET e TWO_FACTOR_ENCRYPTION_KEY no ambiente do operador.',
    );
  const [{ PrismaService }, { ConfigService }, { AuthAttemptLimiter }, { AdminEnrollmentService }] =
    await Promise.all([
      import('../../database/prisma.service.js'),
      import('@nestjs/config'),
      import('../auth/auth-attempt-limiter.js'),
      import('./admin-enrollment.service.js'),
    ]);
  const prisma = new PrismaService();
  const config = new ConfigService({ auth: { accessSecret: process.env.JWT_ACCESS_SECRET } });
  const limiter = new AuthAttemptLimiter(prisma, config);
  const service = new AdminEnrollmentService(prisma, limiter);
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await prisma.$connect();
    await runEmergencyRecovery(email, service, {
      question: (prompt) => readline.question(prompt),
      showQr: async (dataUrl) => {
        const qr = await serveEnrollmentQr(dataUrl);
        process.stdout.write(`Abra o QR privado neste computador: ${qr.url}\n`);
        return qr.close;
      },
      showRecoveryCodes: (codes) =>
        process.stdout.write(
          `Guarde estes códigos em local seguro; serão exibidos apenas agora:\n${codes.join('\n')}\n`,
        ),
      warn: (message) => process.stdout.write(`${message}\n`),
    });
  } finally {
    readline.close();
    await prisma.$disconnect();
  }
}

// Importar este arquivo em teste ou no backend nunca abre conexão nem recupera nada.
if (require.main === module) {
  void main().catch(() => {
    // Erro de driver pode conter credencial. Não imprimir a exceção crua.
    process.stderr.write(
      'Recuperação não concluída. Verifique o ambiente, a confirmação e o código em um terminal privado.\n',
    );
    process.exitCode = 1;
  });
}
