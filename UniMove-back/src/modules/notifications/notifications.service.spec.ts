import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service';
import { NotificationType } from '../../generated/prisma/enums';
import { NotificationService } from './notifications.service';

describe('NotificationService', () => {
  const create = jest.fn();
  const updateMany = jest.fn();
  const count = jest.fn();
  const findMany = jest.fn();
  const transaction = jest.fn(async (operations: Array<Promise<unknown>>) =>
    Promise.all(operations),
  );
  const prisma = {
    notification: { create, updateMany, count, findMany },
    $transaction: transaction,
  } as unknown as PrismaService;
  const service = new NotificationService(prisma);
  const input = {
    userId: '11111111-1111-1111-1111-111111111111',
    type: NotificationType.RIDE_REQUEST_RECEIVED,
    title: 'Nova solicitação',
    message: 'Uma vaga foi solicitada.',
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates a notification for the intended user with readAt initially null', async () => {
    create.mockResolvedValue({ id: 'notification-id', ...input, readAt: null });
    const notification = await service.create(input);
    expect(create).toHaveBeenCalledWith({ data: input });
    expect(notification?.userId).toBe(input.userId);
    expect(notification?.readAt).toBeNull();
  });

  it('marks only an owned notification as read', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await service.markAsRead(input.userId, 'notification-id');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'notification-id', userId: input.userId },
      data: { readAt: expect.any(Date) },
    });
  });

  it('hides another user notification as not found', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(service.markAsRead('other-user', 'notification-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns the unread count for the authenticated user', async () => {
    count.mockResolvedValue(3);
    await expect(service.unreadCount(input.userId)).resolves.toEqual({ count: 3 });
    expect(count).toHaveBeenCalledWith({ where: { userId: input.userId, readAt: null } });
  });

  it('marks all unread notifications for the authenticated user', async () => {
    updateMany.mockResolvedValue({ count: 2 });
    await expect(service.markAllAsRead(input.userId)).resolves.toEqual({ updated: 2 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: input.userId, readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  it('filters the inbox by category tab, newest first', async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
    await service.list(input.userId, { page: 2, limit: 10, category: 'messages' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: input.userId, type: { in: [NotificationType.MESSAGE_RECEIVED] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 10,
        take: 10,
      }),
    );
  });

  it('marks the notifications of an opened resource as read', async () => {
    updateMany.mockResolvedValue({ count: 2 });
    await expect(
      service.markResourceAsRead(input.userId, 'CONVERSATION', 'conversation-id'),
    ).resolves.toEqual({ updated: 2 });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        userId: input.userId,
        resourceType: 'CONVERSATION',
        resourceId: 'conversation-id',
        readAt: null,
      },
      data: { readAt: expect.any(Date) },
    });
  });

  it('removes only an owned notification', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const owned = new NotificationService({
      notification: { deleteMany },
    } as unknown as PrismaService);
    await expect(owned.remove('other-user', 'notification-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: 'notification-id', userId: 'other-user' },
    });
  });

  describe('inside a transaction', () => {
    const ride = {
      departureAt: new Date('2026-12-01T11:00:00.000Z'),
      originLocation: { name: 'Taguatinga' },
      destinationLocation: { name: 'UCB Taguatinga' },
      driver: { fullName: 'Bruno Motorista' },
    };
    function transaction() {
      return {
        ride: { findUnique: jest.fn().mockResolvedValue(ride) },
        notification: {
          create: jest.fn((args: { data: unknown }) => ({
            id: 'created',
            ...(args.data as object),
          })),
          createMany: jest.fn().mockResolvedValue({ count: 2 }),
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn((args: { data: unknown }) => ({
            id: 'merged',
            ...(args.data as object),
          })),
        },
      };
    }

    it('records the ride route, departure and driver with the activity', async () => {
      const tx = transaction();
      await service.create(
        { ...input, metadata: { rideId: 'ride-id' } },
        tx as unknown as PrismaService,
      );
      expect(tx.notification.create).toHaveBeenCalledWith({
        data: {
          ...input,
          metadata: {
            rideId: 'ride-id',
            ride: {
              origin: 'Taguatinga',
              destination: 'UCB Taguatinga',
              departureAt: '2026-12-01T11:00:00.000Z',
              driverName: 'Bruno Motorista',
            },
          },
        },
      });
    });

    it('loads each ride once when notifying several passengers', async () => {
      const tx = transaction();
      await service.createMany(
        ['a', 'b'].map((userId) => ({
          ...input,
          userId,
          type: NotificationType.RIDE_CANCELLED,
          resourceType: 'RIDE',
          resourceId: 'ride-id',
        })),
        tx as unknown as PrismaService,
      );
      expect(tx.ride.findUnique).toHaveBeenCalledTimes(1);
      const rows = tx.notification.createMany.mock.calls[0][0].data as { id: string }[];
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.id)).size).toBe(2);
    });

    it('groups unread messages from the same conversation into one notification', async () => {
      const tx = transaction();
      tx.notification.findFirst.mockResolvedValue({ id: 'existing', metadata: { count: 2 } });
      const saved = await service.create(
        {
          userId: input.userId,
          type: NotificationType.MESSAGE_RECEIVED,
          title: 'Nova mensagem de Bruno',
          message: 'Estou chegando.',
          resourceType: 'CONVERSATION',
          resourceId: 'conversation-id',
          metadata: { senderName: 'Bruno' },
        },
        tx as unknown as PrismaService,
      );
      expect(tx.notification.create).not.toHaveBeenCalled();
      expect(tx.notification.update).toHaveBeenCalledWith({
        where: { id: 'existing' },
        data: {
          title: 'Nova mensagem de Bruno',
          message: 'Estou chegando.',
          metadata: { senderName: 'Bruno', count: 3 },
          createdAt: expect.any(Date),
        },
      });
      expect(saved?.id).toBe('merged');
    });
  });
});
