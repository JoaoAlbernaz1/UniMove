import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { NotificationType, ReservationStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../database/prisma.service';
import { NotificationService } from '../notifications/notifications.service';

const eligibleReservationStatuses = [ReservationStatus.CONFIRMED, ReservationStatus.COMPLETED];

const conversationInclude = {
  ride: {
    select: {
      id: true,
      driverId: true,
      departureAt: true,
      driver: { select: { id: true, fullName: true } },
      originLocation: { select: { name: true } },
      destinationLocation: { select: { name: true } },
      reservations: {
        where: { status: { in: eligibleReservationStatuses } },
        select: { passengerId: true },
      },
    },
  },
  passenger: { select: { id: true, fullName: true } },
  messages: {
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
    select: { id: true, content: true, senderId: true, createdAt: true },
  },
} satisfies Prisma.MessageConversationInclude;

type ConversationRecord = Prisma.MessageConversationGetPayload<{
  include: typeof conversationInclude;
}>;

function toConversationSummary(conversation: ConversationRecord) {
  return {
    id: conversation.id,
    rideId: conversation.rideId,
    passengerId: conversation.passengerId,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    passenger: conversation.passenger,
    messages: conversation.messages,
    ride: {
      id: conversation.ride.id,
      departureAt: conversation.ride.departureAt,
      driver: conversation.ride.driver,
      originLocation: conversation.ride.originLocation,
      destinationLocation: conversation.ride.destinationLocation,
    },
  };
}

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async listRideParticipants(userId: string, rideId: string) {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: {
        driverId: true,
        driver: { select: { id: true, fullName: true } },
        reservations: {
          where: { status: { in: eligibleReservationStatuses } },
          select: {
            passengerId: true,
            passenger: { select: { id: true, fullName: true } },
          },
        },
      },
    });
    if (!ride) throw new NotFoundException('Carona não encontrada.');

    if (ride.driverId === userId) {
      return ride.reservations
        .filter(({ passengerId }) => passengerId !== userId)
        .map(({ passenger }) => passenger);
    }

    const isPassenger = ride.reservations.some(({ passengerId }) => passengerId === userId);
    if (!isPassenger) throw new NotFoundException('Carona não encontrada.');
    return [ride.driver];
  }

  async startConversation(userId: string, rideId: string, requestedPassengerId?: string) {
    const participants = await this.listRideParticipants(userId, rideId);
    const isDriver = await this.prisma.ride.findFirst({
      where: { id: rideId, driverId: userId },
      select: { id: true },
    });

    let passengerId: string;
    if (isDriver) {
      if (!requestedPassengerId)
        throw new BadRequestException('Selecione o passageiro da conversa.');
      if (!participants.some(({ id }) => id === requestedPassengerId))
        throw new NotFoundException('Passageiro não encontrado nesta carona.');
      passengerId = requestedPassengerId;
    } else {
      if (requestedPassengerId && requestedPassengerId !== userId)
        throw new NotFoundException('Carona não encontrada.');
      passengerId = userId;
    }

    const conversation = await this.prisma.messageConversation.upsert({
      where: { rideId_passengerId: { rideId, passengerId } },
      create: { rideId, passengerId },
      update: {},
      include: conversationInclude,
    });
    return toConversationSummary(conversation);
  }

  async listConversations(userId: string) {
    const conversations = await this.prisma.messageConversation.findMany({
      where: { OR: [{ passengerId: userId }, { ride: { driverId: userId } }] },
      include: conversationInclude,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    return conversations
      .filter((conversation) =>
        conversation.ride.reservations.some(
          ({ passengerId }) => passengerId === conversation.passengerId,
        ),
      )
      .map(toConversationSummary);
  }

  async listAvailableParticipants(userId: string) {
    const rides = await this.prisma.ride.findMany({
      where: {
        OR: [
          {
            driverId: userId,
            reservations: { some: { status: { in: eligibleReservationStatuses } } },
          },
          {
            reservations: {
              some: { passengerId: userId, status: { in: eligibleReservationStatuses } },
            },
          },
        ],
      },
      orderBy: { departureAt: 'desc' },
      take: 100,
      select: {
        id: true,
        departureAt: true,
        driverId: true,
        driver: { select: { id: true, fullName: true } },
        originLocation: { select: { name: true } },
        destinationLocation: { select: { name: true } },
        reservations: {
          where: { status: { in: eligibleReservationStatuses } },
          select: {
            passengerId: true,
            passenger: { select: { id: true, fullName: true } },
          },
        },
      },
    });
    if (!rides.length) return [];

    const conversations = await this.prisma.messageConversation.findMany({
      where: {
        rideId: { in: rides.map(({ id }) => id) },
        OR: [{ passengerId: userId }, { ride: { driverId: userId } }],
      },
      select: { rideId: true, passengerId: true },
    });
    const existingConversations = new Set(
      conversations.map(({ rideId, passengerId }) => `${rideId}:${passengerId}`),
    );

    return rides.flatMap((ride) => {
      const isDriver = ride.driverId === userId;
      const passengers = ride.reservations.filter(
        ({ passengerId }) => passengerId !== ride.driverId,
      );
      const contacts = isDriver
        ? passengers.map(({ passengerId, passenger }) => ({ id: passengerId, user: passenger }))
        : passengers
            .filter(({ passengerId }) => passengerId === userId)
            .map(() => ({ id: userId, user: ride.driver }));

      return contacts
        .filter(({ id }) => !existingConversations.has(`${ride.id}:${id}`))
        .map(({ user }) => ({
          rideId: ride.id,
          departureAt: ride.departureAt,
          originLocation: ride.originLocation,
          destinationLocation: ride.destinationLocation,
          participant: user,
          role: isDriver ? 'DRIVER' : 'PASSENGER',
        }));
    });
  }

  async listMessages(userId: string, conversationId: string, after?: string) {
    await this.getAuthorizedConversation(userId, conversationId);

    if (after) {
      const cursor = await this.prisma.chatMessage.findFirst({
        where: { id: after, conversationId },
        select: { id: true, createdAt: true },
      });
      if (!cursor) throw new NotFoundException('Mensagem não encontrada nesta conversa.');
      return this.prisma.chatMessage.findMany({
        where: {
          conversationId,
          OR: [
            { createdAt: { gt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { gt: cursor.id } },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 100,
        include: { sender: { select: { id: true, fullName: true } } },
      });
    }

    const messages = await this.prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      include: { sender: { select: { id: true, fullName: true } } },
    });
    return messages.reverse();
  }

  async sendMessage(userId: string, conversationId: string, content: string) {
    await this.getAuthorizedConversation(userId, conversationId);
    const trimmedContent = content.trim();
    if (!trimmedContent) throw new BadRequestException('Digite uma mensagem antes de enviar.');
    if (trimmedContent.length > 2000)
      throw new BadRequestException('A mensagem deve ter no máximo 2000 caracteres.');

    const conversation = await this.prisma.messageConversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: {
        passengerId: true,
        ride: { select: { driverId: true } },
      },
    });
    const recipientId =
      userId === conversation.passengerId ? conversation.ride.driverId : conversation.passengerId;

    return this.prisma.$transaction(async (tx) => {
      const message = await tx.chatMessage.create({
        data: { conversationId, senderId: userId, content: trimmedContent },
        include: { sender: { select: { id: true, fullName: true } } },
      });
      await tx.messageConversation.update({
        where: { id: conversationId },
        data: { updatedAt: message.createdAt },
      });
      await this.notifications.create(
        {
          userId: recipientId,
          type: NotificationType.MESSAGE_RECEIVED,
          title: 'Nova mensagem',
          message: `${message.sender.fullName} enviou uma mensagem.`,
          resourceType: 'CONVERSATION',
          resourceId: conversationId,
        },
        tx,
      );
      return message;
    });
  }

  private async getAuthorizedConversation(userId: string, conversationId: string) {
    const conversation = await this.prisma.messageConversation.findUnique({
      where: { id: conversationId },
      select: {
        rideId: true,
        passengerId: true,
        ride: { select: { driverId: true } },
      },
    });
    if (
      !conversation ||
      (conversation.ride.driverId !== userId && conversation.passengerId !== userId)
    ) {
      throw new NotFoundException('Conversa não encontrada.');
    }

    const reservation = await this.prisma.rideReservation.findFirst({
      where: {
        rideId: conversation.rideId,
        passengerId: conversation.passengerId,
        status: { in: eligibleReservationStatuses },
      },
      select: { id: true },
    });
    if (!reservation) throw new NotFoundException('Conversa não encontrada.');
    return conversation;
  }
}
