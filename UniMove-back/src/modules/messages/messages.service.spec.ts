import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service';
import { ReservationStatus } from '../../generated/prisma/enums';
import { NotificationService } from '../notifications/notifications.service';
import { MessagesService } from './messages.service';

describe('MessagesService', () => {
  const rideFindUnique = jest.fn();
  const rideFindFirst = jest.fn();
  const rideFindMany = jest.fn();
  const conversationFindUnique = jest.fn();
  const conversationFindUniqueOrThrow = jest.fn();
  const conversationUpsert = jest.fn();
  const conversationFindMany = jest.fn();
  const reservationFindFirst = jest.fn();
  const chatMessageFindFirst = jest.fn();
  const chatMessageFindMany = jest.fn();
  const chatMessageCreate = jest.fn();
  const conversationUpdate = jest.fn();
  const notificationCreate = jest.fn();
  const transaction = jest.fn((callback: (client: unknown) => unknown) =>
    Promise.resolve(
      callback({
        chatMessage: { create: chatMessageCreate },
        messageConversation: { update: conversationUpdate },
      }),
    ),
  );
  const prisma = {
    ride: { findUnique: rideFindUnique, findFirst: rideFindFirst, findMany: rideFindMany },
    messageConversation: {
      findUnique: conversationFindUnique,
      findUniqueOrThrow: conversationFindUniqueOrThrow,
      upsert: conversationUpsert,
      findMany: conversationFindMany,
    },
    rideReservation: { findFirst: reservationFindFirst },
    chatMessage: { findFirst: chatMessageFindFirst, findMany: chatMessageFindMany },
    $transaction: transaction,
  } as unknown as PrismaService;
  const notifications = {
    create: notificationCreate,
  } as unknown as NotificationService;
  const service = new MessagesService(prisma, notifications);

  beforeEach(() => jest.clearAllMocks());

  it('lists only confirmed or completed passengers to a ride driver', async () => {
    rideFindUnique.mockResolvedValue({
      driverId: 'driver-id',
      driver: { id: 'driver-id', fullName: 'Motorista' },
      reservations: [
        { passengerId: 'passenger-id', passenger: { id: 'passenger-id', fullName: 'Passageiro' } },
      ],
    });

    await expect(service.listRideParticipants('driver-id', 'ride-id')).resolves.toEqual([
      { id: 'passenger-id', fullName: 'Passageiro' },
    ]);
    expect(rideFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ride-id' },
        select: expect.objectContaining({
          reservations: {
            where: { status: { in: [ReservationStatus.CONFIRMED, ReservationStatus.COMPLETED] } },
            select: expect.any(Object),
          },
        }),
      }),
    );
  });

  it('does not reveal a conversation to a non-participant', async () => {
    conversationFindUnique.mockResolvedValue({
      rideId: 'ride-id',
      passengerId: 'passenger-id',
      ride: { driverId: 'driver-id' },
    });

    await expect(service.listMessages('other-user', 'conversation-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(reservationFindFirst).not.toHaveBeenCalled();
  });

  it('offers only ride contacts without an existing conversation', async () => {
    rideFindMany.mockResolvedValue([
      {
        id: 'ride-id',
        departureAt: new Date('2026-10-25T12:00:00.000Z'),
        driverId: 'driver-id',
        driver: { id: 'driver-id', fullName: 'Motorista' },
        originLocation: { name: 'Centro' },
        destinationLocation: { name: 'Campus' },
        reservations: [
          {
            passengerId: 'passenger-one',
            passenger: { id: 'passenger-one', fullName: 'Passageiro 1' },
          },
          {
            passengerId: 'passenger-two',
            passenger: { id: 'passenger-two', fullName: 'Passageiro 2' },
          },
        ],
      },
    ]);
    conversationFindMany.mockResolvedValue([{ rideId: 'ride-id', passengerId: 'passenger-one' }]);

    await expect(service.listAvailableParticipants('driver-id')).resolves.toEqual([
      {
        rideId: 'ride-id',
        departureAt: new Date('2026-10-25T12:00:00.000Z'),
        originLocation: { name: 'Centro' },
        destinationLocation: { name: 'Campus' },
        participant: { id: 'passenger-two', fullName: 'Passageiro 2' },
        role: 'DRIVER',
      },
    ]);
  });

  it('persists a message and notifies only the other participant', async () => {
    conversationFindUnique.mockResolvedValueOnce({
      rideId: 'ride-id',
      passengerId: 'passenger-id',
      ride: { driverId: 'driver-id' },
    });
    reservationFindFirst.mockResolvedValue({ id: 'reservation-id' });
    conversationFindUniqueOrThrow.mockResolvedValue({
      passengerId: 'passenger-id',
      ride: { driverId: 'driver-id' },
    });
    const createdMessage = {
      id: 'message-id',
      conversationId: 'conversation-id',
      senderId: 'passenger-id',
      content: 'Olá!',
      createdAt: new Date('2026-10-24T12:00:00.000Z'),
      sender: { id: 'passenger-id', fullName: 'Passageiro' },
    };
    chatMessageCreate.mockResolvedValue(createdMessage);

    await expect(service.sendMessage('passenger-id', 'conversation-id', ' Olá! ')).resolves.toEqual(
      createdMessage,
    );
    expect(chatMessageCreate).toHaveBeenCalledWith({
      data: {
        conversationId: 'conversation-id',
        senderId: 'passenger-id',
        content: 'Olá!',
      },
      include: { sender: { select: { id: true, fullName: true } } },
    });
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'driver-id',
        resourceType: 'CONVERSATION',
        resourceId: 'conversation-id',
      }),
      expect.any(Object),
    );
  });
});
