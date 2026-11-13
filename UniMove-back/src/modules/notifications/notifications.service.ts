import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { NotificationType, Prisma } from '../../generated/prisma/client';
import nodemailer from 'nodemailer';
import twilio from 'twilio';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Prisma.InputJsonValue;
}

/** Abas da central de notificações. Cada uma agrupa tipos relacionados. */
export const notificationCategories = ['rides', 'messages', 'account', 'promotions'] as const;
export type NotificationCategory = (typeof notificationCategories)[number];

const categoryTypes: Record<NotificationCategory, NotificationType[]> = {
  rides: [
    NotificationType.RIDE_REQUEST_RECEIVED,
    NotificationType.RIDE_REQUEST_SENT,
    NotificationType.RIDE_REQUEST_ACCEPTED,
    NotificationType.RIDE_REQUEST_REJECTED,
    NotificationType.RIDE_REQUEST_EXPIRED,
    NotificationType.RIDE_CANCELLED,
    NotificationType.RIDE_STARTED,
    NotificationType.RIDE_COMPLETED,
    NotificationType.RIDE_PUBLISHED,
  ],
  messages: [NotificationType.MESSAGE_RECEIVED],
  account: [
    NotificationType.ACCOUNT_UPDATED,
    NotificationType.INCIDENT_UPDATED,
    NotificationType.SYSTEM,
  ],
  promotions: [NotificationType.PROMOTION],
};

export interface ListNotificationsInput {
  page: number;
  limit: number;
  read?: boolean;
  type?: NotificationType;
  category?: NotificationCategory;
}

type PreferenceKey = 'rideRequests' | 'confirmations' | 'chatMessages' | 'safety' | 'promotions';

/** Preferência que controla o envio externo (push, e-mail, SMS) de cada tipo. */
function preferenceFor(type: NotificationType): PreferenceKey | null {
  switch (type) {
    case NotificationType.RIDE_REQUEST_RECEIVED:
    case NotificationType.RIDE_REQUEST_EXPIRED:
      return 'rideRequests';
    case NotificationType.RIDE_REQUEST_SENT:
    case NotificationType.RIDE_REQUEST_ACCEPTED:
    case NotificationType.RIDE_REQUEST_REJECTED:
    case NotificationType.RIDE_CANCELLED:
    case NotificationType.RIDE_STARTED:
    case NotificationType.RIDE_COMPLETED:
    case NotificationType.RIDE_PUBLISHED:
      return 'confirmations';
    case NotificationType.MESSAGE_RECEIVED:
      return 'chatMessages';
    case NotificationType.INCIDENT_UPDATED:
    case NotificationType.SYSTEM:
    case NotificationType.ACCOUNT_UPDATED:
      return 'safety';
    case NotificationType.PROMOTION:
      return 'promotions';
    default:
      return null;
  }
}

/** Avisos de baixa urgência que não são enviados por canais externos. */
const inboxOnlyTypes: NotificationType[] = [
  NotificationType.RIDE_REQUEST_SENT,
  NotificationType.RIDE_PUBLISHED,
];

// O UniMove atende o DF; o "Não perturbe" é configurado no horário de Brasília.
const QUIET_HOURS_TIMEZONE = 'America/Sao_Paulo';

function isRecord(value: unknown): value is Record<string, Prisma.InputJsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type RideContext = {
  origin: string;
  destination: string;
  departureAt: string;
  driverName: string;
};

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  // Nos testes automatizados nenhum push, e-mail ou SMS é disparado.
  private readonly externalDelivery = process.env.NODE_ENV !== 'test';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra a atividade no histórico do usuário. A gravação na caixa de entrada
   * nunca depende das preferências: elas controlam somente push, e-mail e SMS,
   * que são entregues depois da confirmação da transação e sem bloquear a
   * operação de origem.
   */
  async create(input: CreateNotificationInput, client: Prisma.TransactionClient = this.prisma) {
    const enriched = await this.withRideContext(input, client, new Map());
    const saved =
      (await this.mergeUnreadMessage(enriched, client)) ??
      (await client.notification.create({ data: enriched }));
    if (saved) this.scheduleDelivery([{ id: saved.id, input: enriched }]);
    return saved;
  }

  async createMany(
    inputs: CreateNotificationInput[],
    client: Prisma.TransactionClient = this.prisma,
  ) {
    if (!inputs.length) return { count: 0 };
    const cache = new Map<string, Promise<RideContext | null>>();
    // Sequencial: consultas simultâneas na mesma transação não são suportadas pelo driver.
    const data: CreateNotificationInput[] = [];
    for (const input of inputs) data.push(await this.withRideContext(input, client, cache));
    // Ids gerados aqui para associar cada linha à sua entrega externa.
    const rows = data.map((input) => ({ id: randomUUID(), ...input }));
    const result = await client.notification.createMany({ data: rows });
    this.scheduleDelivery(rows.map(({ id, ...input }) => ({ id, input })));
    return result;
  }

  async list(userId: string, input: ListNotificationsInput) {
    const types = input.category ? categoryTypes[input.category] : undefined;
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(input.read === undefined ? {} : { readAt: input.read ? { not: null } : null }),
      ...(input.type ? { type: input.type } : types ? { type: { in: types } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        select: {
          id: true,
          type: true,
          title: true,
          message: true,
          resourceType: true,
          resourceId: true,
          metadata: true,
          readAt: true,
          createdAt: true,
        },
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { items, page: input.page, limit: input.limit, total };
  }

  async markAsRead(userId: string, id: string) {
    const result = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Notificação não encontrada.');
  }

  async markAllAsRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  /** Marca como lidas as notificações de um recurso, por exemplo ao abrir a conversa. */
  async markResourceAsRead(userId: string, resourceType: string, resourceId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, resourceType, resourceId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async remove(userId: string, id: string) {
    const result = await this.prisma.notification.deleteMany({ where: { id, userId } });
    if (!result.count) throw new NotFoundException('Notificação não encontrada.');
  }

  async unreadCount(userId: string) {
    return { count: await this.prisma.notification.count({ where: { userId, readAt: null } }) };
  }

  /**
   * Mensagens novas da mesma conversa, ainda não lidas, ficam agrupadas em uma
   * única notificação (como nos apps de mensagens), atualizada e movida ao topo.
   */
  private async mergeUnreadMessage(
    input: CreateNotificationInput,
    client: Prisma.TransactionClient,
  ) {
    if (input.type !== NotificationType.MESSAGE_RECEIVED || !input.resourceId) return null;
    const existing = await client.notification.findFirst({
      where: {
        userId: input.userId,
        type: NotificationType.MESSAGE_RECEIVED,
        resourceId: input.resourceId,
        readAt: null,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, metadata: true },
    });
    if (!existing) return null;
    const previous = isRecord(existing.metadata) ? existing.metadata : {};
    const previousCount = typeof previous.count === 'number' ? previous.count : 1;
    const metadata = {
      ...(isRecord(input.metadata) ? input.metadata : {}),
      count: previousCount + 1,
    };
    return client.notification.update({
      where: { id: existing.id },
      data: {
        title: input.title,
        message: input.message,
        metadata,
        createdAt: new Date(),
      },
    });
  }

  /** Acrescenta trajeto, horário e motorista para a central exibir o contexto da carona. */
  private async withRideContext(
    input: CreateNotificationInput,
    client: Prisma.TransactionClient,
    cache: Map<string, Promise<RideContext | null>>,
  ): Promise<CreateNotificationInput> {
    const metadata = isRecord(input.metadata) ? input.metadata : undefined;
    const rideId =
      typeof metadata?.rideId === 'string'
        ? metadata.rideId
        : input.resourceType === 'RIDE'
          ? input.resourceId
          : undefined;
    if (!rideId || metadata?.ride || !('ride' in client)) return input;
    if (!cache.has(rideId)) cache.set(rideId, this.loadRideContext(rideId, client));
    const ride = await cache.get(rideId);
    if (!ride) return input;
    return { ...input, metadata: { ...(metadata ?? {}), rideId, ride } };
  }

  private async loadRideContext(
    rideId: string,
    client: Prisma.TransactionClient,
  ): Promise<RideContext | null> {
    const ride = await client.ride.findUnique({
      where: { id: rideId },
      select: {
        departureAt: true,
        originLocation: { select: { name: true } },
        destinationLocation: { select: { name: true } },
        driver: { select: { fullName: true } },
      },
    });
    if (!ride) return null;
    return {
      origin: ride.originLocation.name,
      destination: ride.destinationLocation.name,
      departureAt: ride.departureAt.toISOString(),
      driverName: ride.driver.fullName,
    };
  }

  // ---------------------------------------------------------------------------
  // Canais externos (push, e-mail e SMS)
  // ---------------------------------------------------------------------------

  private scheduleDelivery(entries: { id: string; input: CreateNotificationInput }[]) {
    const pending = entries.filter(({ input }) => !inboxOnlyTypes.includes(input.type));
    if (!this.externalDelivery || !pending.length) return;
    const timer = setTimeout(() => void this.deliver(pending, 0), 250);
    timer.unref?.();
  }

  /**
   * Aguarda a transação de origem ser confirmada: se a notificação ainda não
   * estiver visível, tenta novamente; se nunca aparecer (rollback), nada é enviado.
   */
  private async deliver(
    entries: { id: string; input: CreateNotificationInput }[],
    attempt: number,
  ) {
    try {
      const committed = await this.prisma.notification.findMany({
        where: { id: { in: entries.map(({ id }) => id) } },
        select: { id: true },
      });
      const visible = new Set(committed.map(({ id }) => id));
      const ready = entries.filter(({ id }) => visible.has(id));
      const waiting = entries.filter(({ id }) => !visible.has(id));
      if (waiting.length && attempt < 3) {
        const timer = setTimeout(() => void this.deliver(waiting, attempt + 1), 1000);
        timer.unref?.();
      }
      for (const { input } of ready) await this.dispatchExternal(input);
    } catch (error) {
      this.logger.warn(`Falha ao entregar notificações externas: ${String(error)}`);
    }
  }

  private inQuietHours(start: string, end: string, now = new Date()) {
    const current = new Intl.DateTimeFormat('en-GB', {
      timeZone: QUIET_HOURS_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(now);
    return start <= end ? current >= start && current < end : current >= start || current < end;
  }

  private async dispatchExternal(input: CreateNotificationInput) {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        institutionalEmail: true,
        phone: true,
        notificationPreferences: true,
        pushDevices: { where: { active: true }, select: { token: true } },
      },
    });
    const preference = user?.notificationPreferences;
    // Sem preferências salvas o usuário ainda não escolheu canais externos.
    if (!user || !preference || !preference.enabled) return;
    if (preference.doNotDisturb && this.inQuietHours(preference.quietStart, preference.quietEnd))
      return;
    const key = preferenceFor(input.type);
    if (key && !preference[key]) return;

    const channels: [string, () => Promise<unknown>][] = [];
    if (preference.push && user.pushDevices.length)
      channels.push([
        'push',
        () =>
          this.sendPush(
            user.pushDevices.map((d) => d.token),
            input,
          ),
      ]);
    if (preference.email)
      channels.push(['e-mail', () => this.sendEmail(user.institutionalEmail, input)]);
    if (preference.sms && user.phone)
      channels.push(['SMS', () => this.sendSms(user.phone!, input)]);
    for (const [name, send] of channels) {
      try {
        await send();
      } catch (error) {
        this.logger.warn(`Falha no envio por ${name}: ${String(error)}`);
      }
    }
  }

  private async sendPush(tokens: string[], input: CreateNotificationInput) {
    const { Expo } = await import('expo-server-sdk');
    const expo = new Expo();
    const messages = tokens
      .filter((token) => Expo.isExpoPushToken(token))
      .map((token) => ({
        to: token,
        sound: 'default' as const,
        title: input.title,
        body: input.message,
        data: { type: input.type, resourceType: input.resourceType, resourceId: input.resourceId },
      }));
    if (!messages.length) return;
    const chunks = expo.chunkPushNotifications(messages);
    await Promise.all(chunks.map((chunk) => expo.sendPushNotificationsAsync(chunk)));
  }

  private async sendEmail(email: string, input: CreateNotificationInput) {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return;
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email,
      subject: input.title,
      text: input.message,
    });
  }

  private async sendSms(phone: string, input: CreateNotificationInput) {
    if (
      !process.env.TWILIO_ACCOUNT_SID ||
      !process.env.TWILIO_AUTH_TOKEN ||
      !process.env.TWILIO_FROM
    )
      return;
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      to: phone,
      from: process.env.TWILIO_FROM,
      body: `${input.title}: ${input.message}`,
    });
  }
}
