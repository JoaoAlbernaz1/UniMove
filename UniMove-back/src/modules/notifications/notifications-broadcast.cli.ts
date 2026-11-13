/**
 * Publica uma promoção ou novidade na central de notificações dos usuários.
 *
 *   npm run notifications:broadcast -- --title "Semana sem custo" \
 *     --message "Caronas gratuitas no campus até sexta." [--type PROMOTION|SYSTEM] \
 *     [--to aluno@ucb.edu.br,outra@ucb.edu.br] [--confirm]
 *
 * Sem --confirm, apenas informa quantas contas receberiam a notificação.
 * A mensagem aparece somente no app; push/e-mail não são disparados por este comando.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { NotificationType, UserStatus } from '../../generated/prisma/enums';

const BROADCAST_TYPES = [NotificationType.PROMOTION, NotificationType.SYSTEM] as const;
type BroadcastType = (typeof BROADCAST_TYPES)[number];
const BATCH_SIZE = 500;

/** Erro de uso do comando; seguro para exibir no terminal. */
export class BroadcastUsageError extends Error {}

export interface BroadcastOptions {
  title: string;
  message: string;
  type: BroadcastType;
  recipients: string[];
  confirm: boolean;
}

export function parseBroadcastArgs(argv: string[]): BroadcastOptions {
  const values = new Map<string, string>();
  let confirm = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--confirm') {
      confirm = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new BroadcastUsageError(`Argumento inesperado: ${arg}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--'))
      throw new BroadcastUsageError(`Informe um valor para ${arg}.`);
    values.set(arg.slice(2), value);
    index++;
  }
  const title = values.get('title')?.trim() ?? '';
  const message = values.get('message')?.trim() ?? '';
  if (!title || title.length > 80)
    throw new BroadcastUsageError('--title é obrigatório (até 80 caracteres).');
  if (!message || message.length > 500)
    throw new BroadcastUsageError('--message é obrigatório (até 500 caracteres).');
  const type = (values.get('type') ?? NotificationType.PROMOTION).toUpperCase();
  if (!BROADCAST_TYPES.includes(type as BroadcastType))
    throw new BroadcastUsageError('--type deve ser PROMOTION ou SYSTEM.');
  const recipients = (values.get('to') ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return { title, message, type: type as BroadcastType, recipients, confirm };
}

async function main() {
  const options = parseBroadcastArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new BroadcastUsageError('DATABASE_URL não configurada.');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const users = await prisma.user.findMany({
      where: {
        status: UserStatus.ACTIVE,
        ...(options.recipients.length ? { institutionalEmail: { in: options.recipients } } : {}),
      },
      select: { id: true },
    });
    const scope = options.recipients.length ? 'contas indicadas' : 'contas ativas';
    if (!options.confirm) {
      console.log(
        `Simulação: ${users.length} ${scope} receberiam "${options.title}". Repita com --confirm para publicar.`,
      );
      return;
    }
    const campaignId = randomUUID();
    let total = 0;
    for (let start = 0; start < users.length; start += BATCH_SIZE) {
      const result = await prisma.notification.createMany({
        data: users.slice(start, start + BATCH_SIZE).map(({ id }) => ({
          userId: id,
          type: options.type,
          title: options.title,
          message: options.message,
          resourceType: 'CAMPAIGN',
          resourceId: campaignId,
          metadata: { kind: 'BROADCAST' },
        })),
      });
      total += result.count;
    }
    console.log(`Publicado para ${total} ${scope}. Campanha ${campaignId}.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // Erros do driver podem conter dados de conexão: só os de uso são exibidos.
    console.error(
      error instanceof BroadcastUsageError
        ? error.message
        : 'Publicação não concluída. Verifique DATABASE_URL e a conexão com o banco.',
    );
    process.exitCode = 1;
  });
}
