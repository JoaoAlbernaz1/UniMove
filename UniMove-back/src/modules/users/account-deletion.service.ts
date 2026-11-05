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
import { assertNotLastAdmin, lockAdminInvariant } from '../admin/admin-invariants';

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

    const deletion = this.prisma.$transaction(
      async (tx) => {
        // Mesma ordem usada pela suspensão: primeiro o invariante, depois a conta.
        await lockAdminInvariant(tx);
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
        const current = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { status: true },
        });
        if (current.status !== UserStatus.ACTIVE)
          throw new UnauthorizedException('Conta indisponível para exclusão.');
        await assertNotLastAdmin(tx, userId);

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
        // O autor de uma decisão sobre terceiros continua ligado a ela. A conta fica
        // anonimizada, então isso não expõe a pessoa, e excluir a conta não apaga o rastro.
        await tx.auditLog.updateMany({
          where: {
            OR: [
              { entityId: userId },
              {
                actorUserId: userId,
                NOT: {
                  OR: [
                    { action: { startsWith: 'ADMIN_' } },
                    { action: { startsWith: 'ACADEMIC_VERIFICATION_' } },
                    { action: 'INCIDENT_UPDATED' },
                  ],
                },
              },
            ],
          },
          data: { actorUserId: null, entityId: null, metadata: Prisma.JsonNull, ip: null },
        });
        // Retém autoria/decisão sobre terceiros, mas não o IP pessoal do autor.
        await tx.auditLog.updateMany({ where: { actorUserId: userId }, data: { ip: null } });
        await tx.academicVerification.deleteMany({ where: { userId } });
        await tx.profilePhoto.deleteMany({ where: { userId } });
        await tx.driverLicense.deleteMany({ where: { userId } });
        await tx.userRole.deleteMany({ where: { userId } });
        await tx.refreshSession.deleteMany({ where: { userId } });
        await tx.twoFactorAuth.deleteMany({ where: { userId } });
        await tx.pushDevice.deleteMany({ where: { userId } });

        await tx.user.update({
          where: { id: userId },
          data: {
            fullName: 'Conta excluída',
            institutionalEmail: `deleted+${userId}@deleted.invalid`,
            cpf: `EXCLUIDO-${userId}`,
            studentNumber: null,
            phone: null,
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
    await deletion.catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        const adapterError = error.meta?.driverAdapterError as
          { cause?: { originalCode?: string } } | undefined;
        const postgresCode = error.meta?.code ?? adapterError?.cause?.originalCode;
        if (
          error.code === 'P2034' ||
          (error.code === 'P2010' && (postgresCode === '40001' || postgresCode === '40P01'))
        )
          throw new ConflictException({
            code: 'ACCOUNT_CONCURRENT_UPDATE',
            message: 'A conta foi alterada durante a exclusão. Atualize e tente novamente.',
          });
      }
      throw error;
    });
  }
}
