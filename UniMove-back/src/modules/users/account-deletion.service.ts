import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import {
  ReservationStatus,
  RideRequestStatus,
  RideStatus,
  UserStatus,
} from '../../generated/prisma/enums';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AccountDeletionService {
  constructor(private readonly prisma: PrismaService) {}

  async deleteAccount(userId: string, currentPassword: string) {
    const account = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true, status: true },
    });
    if (
      account.status !== UserStatus.ACTIVE ||
      !(await argon2.verify(account.passwordHash, currentPassword))
    )
      throw new UnauthorizedException('Senha atual inválida.');

    const anonymizedPasswordHash = await argon2.hash(randomBytes(32).toString('hex'), {
      type: argon2.argon2id,
    });

    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
        const current = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { status: true },
        });
        if (current.status !== UserStatus.ACTIVE)
          throw new UnauthorizedException('Conta indisponível para exclusão.');

        const now = new Date();
        const activeRideFilter = {
          status: { in: [RideStatus.OPEN, RideStatus.SCHEDULED, RideStatus.IN_PROGRESS] },
          OR: [{ departureAt: { gt: now } }, { status: RideStatus.IN_PROGRESS }],
        } satisfies Prisma.RideWhereInput;
        const [futureDrives, pendingRequests, confirmedReservations] = await Promise.all([
          tx.ride.count({ where: { driverId: userId, ...activeRideFilter } }),
          tx.rideRequest.count({
            where: {
              passengerId: userId,
              status: RideRequestStatus.PENDING,
              ride: { is: activeRideFilter },
            },
          }),
          tx.rideReservation.count({
            where: {
              passengerId: userId,
              status: ReservationStatus.CONFIRMED,
              ride: { is: activeRideFilter },
            },
          }),
        ]);
        if (futureDrives + pendingRequests + confirmedReservations > 0)
          throw new ConflictException(
            'Antes de apagar sua conta, cancele ou conclua suas caronas futuras, solicitações pendentes e reservas confirmadas.',
          );

        const vehicles = await tx.vehicle.findMany({
          where: { ownerId: userId },
          select: { id: true },
        });
        for (const vehicle of vehicles) {
          await tx.vehicle.update({
            where: { id: vehicle.id },
            data: {
              brand: 'Removido',
              model: 'Removido',
              color: 'Removido',
              plate: `REMOVIDA-${vehicle.id}`,
              active: false,
            },
          });
        }

        await tx.routeTemplate.updateMany({
          where: { driverId: userId },
          data: { active: false },
        });
        await tx.ride.updateMany({
          where: { driverId: userId },
          data: { additionalInfo: null },
        });
        await tx.messageConversation.deleteMany({
          where: {
            OR: [{ passengerId: userId }, { ride: { is: { driverId: userId } } }],
          },
        });
        await tx.notification.deleteMany({ where: { userId } });
        await tx.rating.updateMany({
          where: { OR: [{ reviewerId: userId }, { reviewedUserId: userId }] },
          data: { comment: null },
        });
        await tx.cancellation.updateMany({
          where: { cancelledByUserId: userId },
          data: { reason: 'Dados removidos após exclusão da conta', details: null },
        });
        await tx.incident.updateMany({
          where: { OR: [{ reportedById: userId }, { reportedUserId: userId }] },
          data: { description: 'Descrição removida após exclusão da conta' },
        });
        await tx.auditLog.updateMany({
          where: { OR: [{ actorUserId: userId }, { entityId: userId }] },
          data: { actorUserId: null, entityId: null, metadata: Prisma.JsonNull, ip: null },
        });
        await tx.academicVerification.updateMany({
          where: { reviewedById: userId },
          data: { reviewedById: null },
        });
        await tx.academicVerification.deleteMany({ where: { userId } });
        await tx.profilePhoto.deleteMany({ where: { userId } });
        await tx.driverLicense.deleteMany({ where: { userId } });
        await tx.userRole.deleteMany({ where: { userId } });
        await tx.refreshSession.deleteMany({ where: { userId } });

        await tx.user.update({
          where: { id: userId },
          data: {
            fullName: 'Conta excluída',
            institutionalEmail: `deleted+${userId}@deleted.invalid`,
            cpf: `EXCLUIDO-${userId}`,
            studentNumber: null,
            course: null,
            semester: null,
            bio: null,
            tags: [],
            profileCompletedAt: null,
            termsAcceptedAt: null,
            termsVersion: null,
            privacyPolicyVersion: null,
            passwordHash: anonymizedPasswordHash,
            status: UserStatus.DEACTIVATED,
            deletedAt: now,
          },
        });
        await tx.auditLog.create({
          data: { action: 'USER_ACCOUNT_DELETED', entityType: 'AccountDeletion' },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
