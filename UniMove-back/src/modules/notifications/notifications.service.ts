import { Injectable, NotFoundException } from '@nestjs/common';
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

export interface ListNotificationsInput {
  page: number;
  limit: number;
  read?: boolean;
  type?: NotificationType;
}

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  private inQuietHours(start: string, end: string) {
    const now = new Date();
    const current = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
    return start <= end
      ? current >= start && current < end
      : current >= start || current < end;
  }

  private async isAllowed(input: CreateNotificationInput, client: Prisma.TransactionClient) {
    if (!('user' in client)) return true;
    const user = await client.user.findUnique({
      where: { id: input.userId },
      select: {
        institutionalEmail: true,
        phone: true,
        notificationPreferences: true,
        pushDevices: {
          where: { active: true },
          select: { token: true },
        },
      },
    });
    if (!user) return false;
    const preference = user.notificationPreferences;
    if (!preference || !preference.enabled) return true;
    if (preference.doNotDisturb && this.inQuietHours(preference.quietStart, preference.quietEnd))
      return false;

    let categoryAllowed = true;
    const rideRequestTypes: NotificationType[] = [
      NotificationType.RIDE_REQUEST_RECEIVED,
      NotificationType.RIDE_REQUEST_EXPIRED,
    ];
    if (rideRequestTypes.includes(input.type)) categoryAllowed = preference.rideRequests;
    const rideConfirmationTypes: NotificationType[] = [
      NotificationType.RIDE_REQUEST_ACCEPTED,
      NotificationType.RIDE_REQUEST_REJECTED,
      NotificationType.RIDE_CANCELLED,
      NotificationType.RIDE_STARTED,
      NotificationType.RIDE_COMPLETED,
    ];
    if (rideConfirmationTypes.includes(input.type)) categoryAllowed = preference.confirmations;
    if (input.type === NotificationType.MESSAGE_RECEIVED) categoryAllowed = preference.chatMessages;
    if (input.type === NotificationType.INCIDENT_UPDATED || input.type === NotificationType.SYSTEM)
      categoryAllowed = preference.safety;
    if (!categoryAllowed) return false;

    if (preference.push) await this.sendPush(user.pushDevices.map((device) => device.token), input);
    if (preference.email) await this.sendEmail(user.institutionalEmail, input);
    if (preference.sms && user.phone) await this.sendSms(user.phone, input);
    return true;
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
        data: { resourceType: input.resourceType, resourceId: input.resourceId },
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
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM)
      return;
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({ to: phone, from: process.env.TWILIO_FROM, body: `${input.title}: ${input.message}` });
  }

  async create(input: CreateNotificationInput, client: Prisma.TransactionClient = this.prisma) {
    if (!(await this.isAllowed(input, client))) return null;
    return client.notification.create({ data: input });
  }

  async createMany(inputs: CreateNotificationInput[], client: Prisma.TransactionClient = this.prisma) {
    if (!inputs.length) return Promise.resolve({ count: 0 });
    const allowed: CreateNotificationInput[] = [];
    for (const input of inputs) {
      if (await this.isAllowed(input, client)) allowed.push(input);
    }
    if (!allowed.length) return { count: 0 };
    return client.notification.createMany({ data: allowed });
  }

  async list(userId: string, input: ListNotificationsInput) {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(input.read === undefined ? {} : { readAt: input.read ? { not: null } : null }),
      ...(input.type ? { type: input.type } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
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

  async unreadCount(userId: string) {
    return { count: await this.prisma.notification.count({ where: { userId, readAt: null } }) };
  }
}
