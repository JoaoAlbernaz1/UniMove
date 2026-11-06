import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service';
import { NotificationType, ReservationStatus } from '../../generated/prisma/enums';
import type { NotificationService } from '../notifications/notifications.service';
import { ChatService } from './chat.service';

const driverId = '11111111-1111-1111-1111-111111111111';
const passengerId = '22222222-2222-2222-2222-222222222222';
const conversationId = '33333333-3333-3333-3333-333333333333';

describe('ChatService', () => {
  const conversationFindUnique = jest.fn();
  const reservationFindFirst = jest.fn();
  const messageCreate = jest.fn();
  const conversationUpdate = jest.fn();
  const notify = jest.fn();
  const messageFindFirst = jest.fn();
  const messageUpdateMany = jest.fn();
  const tx = {
    chatMessage: { create: messageCreate },
    messageConversation: { update: conversationUpdate },
  };
  const prisma = {
    chatMessage: { findFirst: messageFindFirst, updateMany: messageUpdateMany },
    messageConversation: { findUnique: conversationFindUnique },
    rideReservation: { findFirst: reservationFindFirst },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      Promise.resolve(callback(tx)),
    ),
  } as unknown as PrismaService;
  const notifications = { create: notify } as unknown as NotificationService;
  const service = new ChatService(prisma, notifications);

  beforeEach(() => jest.clearAllMocks());

  function authorize(status: ReservationStatus = ReservationStatus.CONFIRMED) {
    conversationFindUnique.mockResolvedValue({
      rideId: 'ride-id',
      passengerId,
      ride: { driverId },
    });
    reservationFindFirst.mockResolvedValue({ status });
  }

  it('hides conversations from users who are not a participant', async () => {
    conversationFindUnique.mockResolvedValue({
      rideId: 'ride-id',
      passengerId,
      ride: { driverId },
    });

    await expect(service.listMessages('unrelated-user', conversationId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(reservationFindFirst).not.toHaveBeenCalled();
  });

  it('marks only incoming messages up to the displayed cursor as read', async () => {
    authorize();
    const createdAt = new Date('2026-11-05T12:00:00Z');
    messageFindFirst.mockResolvedValue({ id: 'cursor-id', createdAt });
    messageUpdateMany.mockResolvedValue({ count: 1 });
    await expect(service.markRead(passengerId, conversationId, 'cursor-id')).resolves.toEqual({ count: 1 });
    expect(messageUpdateMany).toHaveBeenCalledWith({ where: {
      conversationId, senderId: { not: passengerId }, readAt: null,
      OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lte: 'cursor-id' } }],
    }, data: { readAt: expect.any(Date) } });
  });

  it('does not let an outsider mark a conversation as read', async () => {
    authorize();
    await expect(service.markRead('outsider', conversationId, 'cursor-id')).rejects.toBeInstanceOf(NotFoundException);
    expect(messageUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects a read cursor from another conversation', async () => {
    authorize();
    messageFindFirst.mockResolvedValue(null);
    await expect(service.markRead(passengerId, conversationId, 'foreign-message')).rejects.toBeInstanceOf(NotFoundException);
    expect(messageFindFirst).toHaveBeenCalledWith({ where: { id: 'foreign-message', conversationId }, select: { id: true, createdAt: true } });
    expect(messageUpdateMany).not.toHaveBeenCalled();
  });

  it('persists a message and notifies the other participant in one transaction', async () => {
    authorize();
    const createdAt = new Date('2026-10-25T12:00:00.000Z');
    messageCreate.mockResolvedValue({
      id: 'message-id',
      conversationId,
      senderId: passengerId,
      content: 'Chego em cinco minutos.',
      createdAt,
      sender: { id: passengerId, fullName: 'Passageiro' },
    });

    const message = await service.sendMessage(
      passengerId,
      conversationId,
      '  Chego em cinco minutos.  ',
    );

    expect(messageCreate).toHaveBeenCalledWith({
      data: { conversationId, senderId: passengerId, content: 'Chego em cinco minutos.' },
      include: { sender: { select: { id: true, fullName: true } } },
    });
    expect(conversationUpdate).toHaveBeenCalledWith({
      where: { id: conversationId },
      data: { updatedAt: createdAt },
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: driverId,
        type: NotificationType.MESSAGE_RECEIVED,
        resourceId: conversationId,
      }),
      tx,
    );
    expect(message.id).toBe('message-id');
  });

  it('rejects sending messages after a reservation is completed', async () => {
    authorize(ReservationStatus.COMPLETED);

    await expect(service.sendMessage(passengerId, conversationId, 'Olá')).rejects.toThrow(
      'Só é possível enviar mensagens enquanto a reserva estiver confirmada.',
    );
    expect(messageCreate).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('rejects messages containing only whitespace', async () => {
    authorize();

    await expect(service.sendMessage(passengerId, conversationId, '   ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(messageCreate).not.toHaveBeenCalled();
  });
});
