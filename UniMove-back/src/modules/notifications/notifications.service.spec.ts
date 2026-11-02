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
});
