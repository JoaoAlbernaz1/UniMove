import type { PrismaService } from '../../database/prisma.service';
import { HomeIndicatorsService } from './home-indicators.controller';

describe('Home indicators', () => {
  it.each([
    [0, false, false],
    [1, true, false],
    [0, false, true],
  ])(
    'uses pending requests and unread messages independently (%p)',
    async (pending, requests, messages) => {
      const prisma = {
        rideRequest: { count: jest.fn().mockResolvedValue(pending) },
        $queryRaw: jest.fn().mockResolvedValue([{ hasUnreadMessages: messages }]),
      };
      const result = await new HomeIndicatorsService(prisma as unknown as PrismaService).get(
        'user-id',
      );
      expect(result).toEqual({ hasPendingRideRequests: requests, hasUnreadMessages: messages });
      expect(prisma.rideRequest.count).toHaveBeenCalledWith({
        where: {
          status: 'PENDING',
          expiresAt: { gt: expect.any(Date) },
          ride: {
            driverId: 'user-id',
            status: { in: ['OPEN', 'SCHEDULED'] },
            departureAt: { gt: expect.any(Date) },
          },
        },
      });
    },
  );
});
