import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class DriverMembershipService {
  constructor(private readonly prisma: PrismaService) {}

  async leave(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Vehicle registration and publication use the same lock to avoid an offer
      // being created while its driver is leaving.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const activeRides = await tx.ride.count({
        where: { driverId: userId, status: { in: ['OPEN', 'SCHEDULED', 'IN_PROGRESS'] } },
      });
      if (activeRides)
        throw new ConflictException(
          'Cancele ou conclua suas caronas abertas ou em andamento antes de deixar de ser motorista.',
        );

      await tx.vehicle.updateMany({
        where: { ownerId: userId, active: true },
        data: { active: false },
      });
      await tx.routeTemplate.updateMany({
        where: { driverId: userId, active: true },
        data: { active: false },
      });
      await tx.userRole.deleteMany({ where: { userId, role: { name: 'DRIVER' } } });
      const passenger = await tx.role.upsert({
        where: { name: 'PASSENGER' },
        update: {},
        create: { name: 'PASSENGER' },
      });
      await tx.userRole.upsert({
        where: { userId_roleId: { userId, roleId: passenger.id } },
        update: {},
        create: { userId, roleId: passenger.id },
      });
      return {
        message:
          'Você deixou de ser motorista. Seus carros foram desativados e sua conta continua como passageiro.',
      };
    });
  }
}
