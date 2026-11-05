import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline/promises';
import type { AdminEnrollmentService } from './admin-enrollment.service';

interface EnrollmentIo {
  question(prompt: string): Promise<string>;
  showQr(dataUrl: string): Promise<() => Promise<void>>;
  showRecoveryCodes(codes: string[]): void;
}

export async function runEnrollment(
  emailInput: string,
  service: Pick<AdminEnrollmentService, 'begin' | 'confirm'>,
  io: EnrollmentIo,
) {
  const email = emailInput.trim().toLowerCase();
  const confirmation = await io.question(
    `Confirme a identidade do administrador por um canal confiável. Digite PROVISIONAR ${email}: `,
  );
  if (confirmation !== `PROVISIONAR ${email}`) throw new Error('Provisionamento cancelado.');
  const enrollment = await service.begin(email);
  const closeQr = await io.showQr(enrollment.qrCode);
  try {
    const code = await io.question('Código atual do autenticador: ');
    const { recoveryCodes } = await service.confirm(email, code);
    io.showRecoveryCodes(recoveryCodes);
  } finally {
    await closeQr();
  }
}

/** QR lives only in memory on loopback, behind an unguessable path, until confirmation. */
export async function serveEnrollmentQr(qrCode: string) {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(qrCode)) throw new Error('QR inválido.');
  const path = `/${randomUUID()}`;
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; img-src data:; frame-ancestors 'none'",
    );
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (request.method !== 'GET' || request.url !== path) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(
      `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Provisionamento privado</title><h1>UniCarona Admin</h1><p>Escaneie no autenticador e confirme o código no terminal. Esta página será encerrada após a confirmação.</p><img alt="QR do autenticador" src="${qrCode}"></html>`,
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Não foi possível abrir o QR privado.');
  return {
    url: `http://127.0.0.1:${address.port}${path}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('Execute em um terminal privado interativo, sem redirecionamento de saída.');
  const [email, ...extra] = process.argv.slice(2);
  if (!email || extra.length) throw new Error('Uso: npm run admin:enroll -- admin@ucb.edu.br');
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
    await runEnrollment(email, service, {
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
    });
  } finally {
    readline.close();
    await prisma.$disconnect();
  }
}

// Importing this file in tests or the backend never opens a connection or provisions a user.
if (require.main === module) {
  void main().catch(() => {
    // Driver/framework errors may contain credentials. Do not print the raw exception.
    process.stderr.write(
      'Provisionamento não concluído. Verifique o ambiente, a confirmação e o código em um terminal privado.\n',
    );
    process.exitCode = 1;
  });
}
