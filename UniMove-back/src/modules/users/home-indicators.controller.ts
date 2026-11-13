import { Controller, Get, Injectable } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/decorators/auth.decorators';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class HomeIndicatorsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string) {
    const now = new Date();
    const [pendingRequests, unread, unreadNotifications] = await Promise.all([
      this.prisma.rideRequest.count({
        where: {
          status: 'PENDING',
          expiresAt: { gt: now },
          ride: {
            driverId: userId,
            status: { in: ['OPEN', 'SCHEDULED'] },
            departureAt: { gt: now },
          },
        },
      }),
      this.prisma.$queryRaw<{ hasUnreadMessages: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM chat_messages m
          JOIN message_conversations c ON c.id = m.conversation_id
          JOIN rides r ON r.id = c.ride_id
          WHERE m.read_at IS NULL AND m.sender_id <> ${userId}::uuid
            AND (c.passenger_id = ${userId}::uuid OR r.driver_id = ${userId}::uuid)
            AND m.sender_id IN (c.passenger_id, r.driver_id)
            AND EXISTS (
              SELECT 1 FROM ride_reservations rr
              WHERE rr.ride_id = c.ride_id AND rr.passenger_id = c.passenger_id
                AND rr.status IN ('CONFIRMED', 'COMPLETED')
            )
        ) AS "hasUnreadMessages"`,
      // Contador do sino da Home (central de notificações).
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return {
      hasPendingRideRequests: pendingRequests > 0,
      hasUnreadMessages: unread[0]?.hasUnreadMessages ?? false,
      unreadNotifications,
    };
  }
}

@Controller('users/me/indicators')
export class HomeIndicatorsController {
  constructor(private readonly indicators: HomeIndicatorsService) {}
  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.indicators.get(user.id);
  }
}
