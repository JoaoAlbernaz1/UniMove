import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import {
  NotificationType,
  ReservationStatus,
  RideRequestStatus,
  RideStatus,
  RoleName,
  UserStatus,
} from '../../generated/prisma/enums';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import {
  type CreateNotificationInput,
  NotificationService,
} from '../notifications/notifications.service';
import { AdminUsersQueryDto, UpdateUserStatusDto } from './admin.dto';
import { assertNotLastAdmin, lockAdminInvariant } from './admin-invariants';

const RESTRICTION_REASON = 'ADMIN_ACCOUNT_RESTRICTED';

function futureRide(now: Date): Prisma.RideWhereInput {
  return { status: { in: [RideStatus.OPEN, RideStatus.SCHEDULED] }, departureAt: { gt: now } };
}

/** Placa é dado pessoal indireto: o painel só precisa reconhecer o veículo. */
export function maskPlate(plate: string) {
  if (plate.length < 4) return '•••';
  return `${plate.slice(0, 1)}${'•'.repeat(plate.length - 3)}${plate.slice(-2)}`;
}

function roleNames(roles: { role: { name: RoleName } }[]) {
  return roles.map((item) => item.role.name);
}

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async list(query: AdminUsersQueryDto) {
    const where: Prisma.UserWhereInput = {
      ...(query.q
        ? {
            OR: [
              { fullName: { contains: query.q, mode: 'insensitive' } },
              { institutionalEmail: { contains: query.q, mode: 'insensitive' } },
              { studentNumber: { equals: query.q } },
            ],
          }
        : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.role ? { roles: { some: { role: { name: query.role } } } } : {}),
      ...(query.verification === 'NONE'
        ? { academicVerification: { is: null } }
        : query.verification
          ? { academicVerification: { is: { status: query.verification } } }
          : {}),
    };
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          fullName: true,
          institutionalEmail: true,
          course: true,
          status: true,
          createdAt: true,
          deletedAt: true,
          roles: { select: { role: { select: { name: true } } } },
          academicVerification: { select: { status: true } },
        },
        orderBy: { createdAt: query.sort === 'oldest' ? 'asc' : 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      total,
      items: users.map(({ roles, academicVerification, ...user }) => ({
        ...user,
        roles: roleNames(roles),
        verificationStatus: academicVerification?.status ?? null,
      })),
    };
  }

  async detail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        fullName: true,
        institutionalEmail: true,
        studentNumber: true,
        course: true,
        semester: true,
        status: true,
        createdAt: true,
        deletedAt: true,
        profileCompletedAt: true,
        roles: { select: { role: { select: { name: true } } } },
        academicVerification: {
          select: { status: true, submittedAt: true, reviewedAt: true, reviewNote: true },
        },
        vehicles: {
          where: { active: true },
          select: { id: true, brand: true, model: true, color: true, year: true, plate: true },
        },
        _count: {
          select: {
            drivenRides: true,
            reservations: true,
            incidentsReported: true,
            incidentsAgainst: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    const [rating, history] = await Promise.all([
      this.prisma.rating.aggregate({
        where: { reviewedUserId: id },
        _avg: { score: true },
        _count: { score: true },
      }),
      this.prisma.auditLog.findMany({
        where: { entityType: 'User', entityId: id, action: { startsWith: 'ADMIN_USER_' } },
        select: {
          id: true,
          action: true,
          metadata: true,
          createdAt: true,
          actor: { select: { fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);
    const { roles, vehicles, _count, ...profile } = user;
    return {
      ...profile,
      roles: roleNames(roles),
      vehicles: vehicles.map(({ plate, ...vehicle }) => ({ ...vehicle, plate: maskPlate(plate) })),
      counts: _count,
      rating: { average: rating._avg.score, count: rating._count.score },
      adminHistory: history,
    };
  }

  async impact(id: string) {
    const exists = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Usuário não encontrado.');
    return this.readImpact(this.prisma, id, new Date());
  }

  async changeStatus(actor: AuthUser, id: string, dto: UpdateUserStatusDto) {
    if (actor.id === id)
      throw new ConflictException({
        code: 'CANNOT_CHANGE_OWN_STATUS',
        message: 'Você não pode alterar a situação da sua própria conta.',
      });

    const restricting = dto.status !== UserStatus.ACTIVE;
    const { user, pendingNotifications, consequences } = await this.prisma.$transaction(
      async (tx) => {
        await lockAdminInvariant(tx);
        const now = new Date();
        const [actorNow, target] = await Promise.all([
          tx.user.findUnique({
            where: { id: actor.id },
            select: { status: true, roles: { select: { role: { select: { name: true } } } } },
          }),
          tx.user.findUnique({ where: { id }, select: { status: true, deletedAt: true } }),
        ]);
        // Depois do lock: outro admin pode ter suspendido este enquanto ele aguardava.
        if (
          actorNow?.status !== UserStatus.ACTIVE ||
          !roleNames(actorNow.roles).includes(RoleName.ADMIN)
        )
          throw new ForbiddenException('Seu acesso administrativo não está mais válido.');
        if (!target) throw new NotFoundException('Usuário não encontrado.');
        if (target.deletedAt || target.status === UserStatus.DEACTIVATED)
          throw new ConflictException({
            code: 'ACCOUNT_DEACTIVATED',
            message: 'Conta excluída ou desidentificada não pode ser reativada por aqui.',
          });
        if (target.status === dto.status)
          throw new ConflictException({
            code: 'STATUS_UNCHANGED',
            message: 'A conta já está nessa situação. Atualize a página.',
          });
        if (restricting) await assertNotLastAdmin(tx, id);

        // Quem já estava restrito não tem compromisso novo: as consequências só
        // valem na saída de ACTIVE.
        const applyConsequences = restricting && target.status === UserStatus.ACTIVE;
        let notifications: CreateNotificationInput[] = [];
        let consequences = { ridesCancelled: 0, reservationsCancelled: 0, requestsCancelled: 0 };
        if (applyConsequences) {
          const impact = await this.readImpact(tx, id, now);
          if (impact.ridesInProgress)
            throw new ConflictException({
              code: 'RIDE_IN_PROGRESS',
              message: 'O motorista tem carona em andamento. Aguarde a conclusão para restringir.',
              impact,
            });
          const commitments =
            impact.futureRidesAsDriver +
            impact.reservationsAsPassenger +
            impact.pendingRequestsAsPassenger;
          if (commitments && !dto.confirmImpact)
            throw new ConflictException({
              code: 'IMPACT_CONFIRMATION_REQUIRED',
              message:
                'A conta tem caronas ou reservas futuras. Confirme o impacto para continuar.',
              impact,
            });
          ({ notifications, consequences } = await this.applyRestriction(tx, actor.id, id, now));
        }

        const user = await tx.user.update({
          where: { id },
          data: { status: dto.status },
          select: {
            id: true,
            fullName: true,
            institutionalEmail: true,
            status: true,
            updatedAt: true,
          },
        });
        // Vale para o app também: a próxima renovação de sessão da conta é recusada.
        if (restricting)
          await tx.refreshSession.updateMany({
            where: { userId: id, revokedAt: null },
            data: { revokedAt: now },
          });
        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: `ADMIN_USER_${dto.status}`,
            entityType: 'User',
            entityId: id,
            metadata: { reason: dto.reason, previousStatus: target.status, ...consequences },
          },
        });
        return { user, pendingNotifications: notifications, consequences };
      },
      { timeout: 30000, maxWait: 10000 },
    );

    const notificationsDelivered = await this.deliver(pendingNotifications);
    return { ...user, consequences, notificationsDelivered };
  }

  private async readImpact(client: Prisma.TransactionClient, userId: string, now: Date) {
    const future = futureRide(now);
    const [ridesInProgress, rides, reservationsAsPassenger, pendingRequestsAsPassenger] =
      await Promise.all([
        client.ride.count({ where: { driverId: userId, status: RideStatus.IN_PROGRESS } }),
        client.ride.findMany({
          where: { driverId: userId, ...future },
          select: {
            _count: {
              select: { reservations: { where: { status: ReservationStatus.CONFIRMED } } },
            },
          },
        }),
        client.rideReservation.count({
          where: {
            passengerId: userId,
            status: ReservationStatus.CONFIRMED,
            ride: { is: future },
          },
        }),
        client.rideRequest.count({
          where: {
            passengerId: userId,
            status: RideRequestStatus.PENDING,
            ride: { is: future },
          },
        }),
      ]);
    return {
      ridesInProgress,
      futureRidesAsDriver: rides.length,
      passengersAffected: rides.reduce((total, ride) => total + ride._count.reservations, 0),
      reservationsAsPassenger,
      pendingRequestsAsPassenger,
    };
  }

  /** Cancela de verdade o que dependia da conta: reservas, vagas, registro e aviso. */
  private async applyRestriction(
    tx: Prisma.TransactionClient,
    actorId: string,
    userId: string,
    now: Date,
  ) {
    const notifications: CreateNotificationInput[] = [];
    const future = futureRide(now);

    const rides = await tx.ride.findMany({
      where: { driverId: userId, ...future },
      select: {
        id: true,
        reservations: {
          where: { status: ReservationStatus.CONFIRMED },
          select: { passengerId: true },
        },
        requests: {
          where: { status: RideRequestStatus.PENDING },
          select: { passengerId: true },
        },
      },
    });
    let driverReservations = 0;
    let driverRequests = 0;
    for (const ride of rides) {
      await tx.ride.update({
        where: { id: ride.id },
        data: { status: RideStatus.CANCELLED, cancelledAt: now },
      });
      const reservations = await tx.rideReservation.updateMany({
        where: { rideId: ride.id, status: ReservationStatus.CONFIRMED },
        data: { status: ReservationStatus.CANCELLED, cancelledAt: now },
      });
      const requests = await tx.rideRequest.updateMany({
        where: { rideId: ride.id, status: RideRequestStatus.PENDING },
        data: { status: RideRequestStatus.CANCELLED, respondedAt: now },
      });
      driverReservations += reservations.count;
      driverRequests += requests.count;
      await tx.cancellation.create({
        data: { rideId: ride.id, cancelledByUserId: actorId, reason: RESTRICTION_REASON },
      });
      const passengers = new Set(
        [...ride.reservations, ...ride.requests].map((item) => item.passengerId),
      );
      for (const passengerId of passengers)
        notifications.push({
          userId: passengerId,
          type: NotificationType.RIDE_CANCELLED,
          title: 'Carona cancelada',
          message: 'Esta carona foi cancelada pela administração do UniCarona.',
          resourceType: 'RIDE',
          resourceId: ride.id,
        });
    }

    const reservations = await tx.rideReservation.findMany({
      where: { passengerId: userId, status: ReservationStatus.CONFIRMED, ride: { is: future } },
      select: { id: true, rideId: true, seats: true, ride: { select: { driverId: true } } },
    });
    for (const reservation of reservations) {
      await tx.rideReservation.update({
        where: { id: reservation.id },
        data: { status: ReservationStatus.CANCELLED, cancelledAt: now },
      });
      await tx.ride.update({
        where: { id: reservation.rideId },
        data: { availableSeats: { increment: reservation.seats } },
      });
      await tx.cancellation.create({
        data: {
          rideId: reservation.rideId,
          reservationId: reservation.id,
          cancelledByUserId: actorId,
          reason: RESTRICTION_REASON,
        },
      });
      notifications.push({
        userId: reservation.ride.driverId,
        type: NotificationType.RIDE_CANCELLED,
        title: 'Reserva cancelada',
        message: 'Uma reserva da sua carona foi cancelada pela administração do UniCarona.',
        resourceType: 'RIDE',
        resourceId: reservation.rideId,
      });
    }

    const passengerRequests = await tx.rideRequest.updateMany({
      where: { passengerId: userId, status: RideRequestStatus.PENDING, ride: { is: future } },
      data: { status: RideRequestStatus.CANCELLED, respondedAt: now },
    });

    return {
      notifications,
      consequences: {
        ridesCancelled: rides.length,
        reservationsCancelled: driverReservations + reservations.length,
        requestsCancelled: driverRequests + passengerRequests.count,
      },
    };
  }

  /**
   * Fora da transação: push, e-mail e SMS são chamadas externas lentas. Falha aqui
   * não desfaz a decisão, mas é informada a quem a tomou.
   */
  private async deliver(notifications: CreateNotificationInput[]) {
    if (!notifications.length) return true;
    try {
      await this.notifications.createMany(notifications);
      return true;
    } catch (error) {
      this.logger.error(
        `Falha ao notificar participantes: ${error instanceof Error ? error.name : 'erro'}`,
      );
      return false;
    }
  }
}
