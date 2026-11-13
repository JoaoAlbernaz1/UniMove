import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Equals, IsInt, IsIn, IsOptional, IsString } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { RequireAcademicVerification } from '../../common/decorators/profile.decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../database/prisma.service';
import {
  NotificationType,
  ReservationStatus,
  RideRequestStatus,
  RideStatus,
} from '../../generated/prisma/enums';
import { NotificationService } from '../notifications/notifications.service';
import { activePendingRequestWhere, heldSeats } from './ride-availability';

export class RequestRideDto {
  @IsInt()
  @Equals(1, { message: 'Cada usuário pode solicitar apenas uma vaga para si.' })
  seats!: number;
}
class CancelDto {
  @IsString() reason!: string;
  @IsOptional() @IsString() details?: string;
}
class MyRidesQuery extends PaginationDto {
  @IsOptional() @IsIn(['driver', 'passenger']) role?: 'driver' | 'passenger';
  @IsOptional() status?: RideStatus;
}

@Controller('rides')
export class RidesController {
  // Removido o 'ridesService: any' daqui, pois usaremos o prisma diretamente

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationService,
  ) {}
  @Post(':rideId/requests')
  @RequireAcademicVerification()
  async request(
    @CurrentUser() user: AuthUser,
    @Param('rideId') rideId: string,
    @Body() _dto: RequestRideDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Serialize requests from the same passenger, including requests for different rides.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM rides WHERE id = ${rideId}::uuid FOR UPDATE`;
      const now = new Date();
      const ride = await tx.ride.findUnique({ where: { id: rideId } });
      if (
        !ride ||
        ![RideStatus.OPEN, RideStatus.SCHEDULED].includes(ride.status as 'OPEN' | 'SCHEDULED') ||
        ride.departureAt <= now
      )
        throw new ConflictException('Carona não está aberta para solicitações.');
      if (ride.driverId === user.id)
        throw new ConflictException('Motorista não pode solicitar a própria carona.');
      const pendingRequest = await tx.rideRequest.findFirst({
        where: activePendingRequestWhere(user.id, now),
        select: { id: true },
      });
      if (pendingRequest)
        throw new ConflictException(
          'Você já tem uma solicitação aguardando o motorista. Aguarde a resposta ou a expiração antes de solicitar outra carona.',
        );
      const minuteStart = new Date(Math.floor(ride.departureAt.getTime() / 60000) * 60000);
      const departureAt = {
        gte: minuteStart,
        lt: new Date(minuteStart.getTime() + 60000),
      };
      const conflictingRide = await tx.ride.findFirst({
        where: {
          departureAt,
          status: {
            in: [RideStatus.OPEN, RideStatus.SCHEDULED, RideStatus.IN_PROGRESS],
          },
          OR: [
            { driverId: user.id },
            {
              reservations: {
                some: {
                  passengerId: user.id,
                  status: ReservationStatus.CONFIRMED,
                },
              },
            },
            {
              requests: {
                some: {
                  passengerId: user.id,
                  status: RideRequestStatus.PENDING,
                  expiresAt: { gt: now },
                },
              },
            },
          ],
        },
      });
      if (conflictingRide)
        throw new ConflictException('Você já possui uma solicitação ou carona neste horário.');
      if (ride.availableSeats - (await heldSeats(tx, rideId, now)) < 1)
        throw new ConflictException('Desculpe, as vagas para esta carona acabaram de esgotar.');

      const request = await tx.rideRequest.create({
        data: {
          rideId,
          passengerId: user.id,
          seatsRequested: 1,
          expiresAt: new Date(
            Math.min(
              ride.departureAt.getTime(),
              now.getTime() + this.config.get<number>('rides.requestExpirationMinutes')! * 60000,
            ),
          ),
        },
      });

      const passenger = await tx.user.findUnique({
        where: { id: user.id },
        select: { fullName: true },
      });
      await this.notifications.create(
        {
          userId: ride.driverId,
          type: NotificationType.RIDE_REQUEST_RECEIVED,
          title: 'Nova solicitação de carona',
          message: `${passenger?.fullName ?? 'Um passageiro'} quer uma vaga na sua carona. Responda antes que o pedido expire.`,
          resourceType: 'RIDE_REQUEST',
          resourceId: request.id,
          metadata: { rideId, passengerId: user.id, passengerName: passenger?.fullName ?? null },
        },
        tx,
      );
      await this.notifications.create(
        {
          userId: user.id,
          type: NotificationType.RIDE_REQUEST_SENT,
          title: 'Solicitação enviada',
          message: 'Seu pedido foi enviado ao motorista. Avisaremos aqui quando ele responder.',
          resourceType: 'RIDE_REQUEST',
          resourceId: request.id,
          metadata: { rideId },
        },
        tx,
      );

      return request;
    });
  }

  @Get('me')
  async mine(@CurrentUser() user: AuthUser, @Query() query: MyRidesQuery) {
    const where =
      query.role === 'driver'
        ? { driverId: user.id }
        : query.role === 'passenger'
          ? { reservations: { some: { passengerId: user.id } } }
          : {
              OR: [{ driverId: user.id }, { reservations: { some: { passengerId: user.id } } }],
            };

    return this.prisma.ride.findMany({
      where: { ...where, ...(query.status ? { status: query.status } : {}) },
      include: {
        originLocation: true,
        destinationLocation: true,
        driver: { select: { id: true, fullName: true } },
        reservations: true,
      },
      orderBy: { departureAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
  }

  @Get('requests/mine')
  async myRequests(@CurrentUser() user: AuthUser) {
    const now = new Date();
    const requests = await this.prisma.rideRequest.findMany({
      where: { passengerId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        rideId: true,
        status: true,
        expiresAt: true,
        seatsRequested: true,
        reservation: { select: { status: true } },
        ride: {
          select: {
            status: true,
            departureAt: true,
            driver: { select: { fullName: true } },
            originLocation: { select: { name: true } },
            destinationLocation: { select: { name: true } },
          },
        },
      },
    });
    return requests.map((request) => ({
      ...request,
      status:
        request.status === RideRequestStatus.PENDING &&
        (request.expiresAt <= now || !['OPEN', 'SCHEDULED'].includes(request.ride.status))
          ? RideRequestStatus.EXPIRED
          : request.status,
    }));
  }

  @Post(':id/start')
  async start(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.transition(
      id,
      user.id,
      [RideStatus.OPEN, RideStatus.SCHEDULED],
      RideStatus.IN_PROGRESS,
      'startedAt',
      NotificationType.RIDE_STARTED,
    );
  }

  @Post(':id/complete')
  async complete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const ride = await this.transition(
      id,
      user.id,
      [RideStatus.IN_PROGRESS],
      RideStatus.COMPLETED,
      'completedAt',
      NotificationType.RIDE_COMPLETED,
    );
    await this.prisma.rideReservation.updateMany({
      where: { rideId: id, status: ReservationStatus.CONFIRMED },
      data: { status: ReservationStatus.COMPLETED },
    });
    return ride;
  }

  @Post(':id/cancel')
  async cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CancelDto) {
    return this.prisma.$transaction(async (tx) => {
      const ride = await tx.ride.findFirst({
        where: { id, driverId: user.id },
      });
      if (!ride) throw new NotFoundException('Carona não encontrada.');
      if (([RideStatus.COMPLETED, RideStatus.CANCELLED] as RideStatus[]).includes(ride.status))
        throw new ConflictException('Estado não permite cancelamento.');

      const updated = await tx.ride.update({
        where: { id },
        data: { status: RideStatus.CANCELLED, cancelledAt: new Date() },
      });

      const reservations = await tx.rideReservation.findMany({
        where: { rideId: id, status: ReservationStatus.CONFIRMED },
      });

      await tx.rideReservation.updateMany({
        where: { rideId: id, status: ReservationStatus.CONFIRMED },
        data: { status: ReservationStatus.CANCELLED, cancelledAt: new Date() },
      });

      await tx.cancellation.create({
        data: { rideId: id, cancelledByUserId: user.id, ...dto },
      });

      if (reservations.length)
        await this.notifications.createMany(
          reservations.map((r) => ({
            userId: r.passengerId,
            type: NotificationType.RIDE_CANCELLED,
            title: 'Carona cancelada',
            message: 'O motorista cancelou esta carona. Busque outra opção para o seu trajeto.',
            resourceType: 'RIDE',
            resourceId: id,
          })),
          tx,
        );

      return updated;
    });
  }

  private async transition(
    id: string,
    driverId: string,
    allowed: RideStatus[],
    status: RideStatus,
    dateField: 'startedAt' | 'completedAt',
    type: NotificationType,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const ride = await tx.ride.findFirst({ where: { id, driverId } });
      if (!ride) throw new NotFoundException('Carona não encontrada.');
      if (ride.status === status) return ride;
      if (!allowed.includes(ride.status))
        throw new ConflictException('Transição de estado inválida.');

      const updated = await tx.ride.update({
        where: { id },
        data: { status, [dateField]: new Date() },
      });

      const passengers = await tx.rideReservation.findMany({
        where: { rideId: id, status: ReservationStatus.CONFIRMED },
        select: { passengerId: true },
      });

      if (passengers.length)
        await this.notifications.createMany(
          passengers.map((p) => ({
            userId: p.passengerId,
            type,
            title: status === RideStatus.IN_PROGRESS ? 'Carona iniciada' : 'Carona concluída',
            message:
              status === RideStatus.IN_PROGRESS
                ? 'O motorista iniciou a carona. Boa viagem!'
                : 'Você chegou! Avalie o motorista para ajudar a comunidade.',
            resourceType: 'RIDE',
            resourceId: id,
          })),
          tx,
        );

      if (status === RideStatus.COMPLETED) {
        await this.notifications.create(
          {
            userId: driverId,
            type: NotificationType.RIDE_COMPLETED,
            title: 'Carona concluída',
            message: passengers.length
              ? `Viagem finalizada com ${passengers.length} ${passengers.length === 1 ? 'passageiro' : 'passageiros'}. Obrigado por compartilhar o trajeto!`
              : 'Viagem finalizada. Obrigado por compartilhar o trajeto!',
            resourceType: 'RIDE',
            resourceId: id,
          },
          tx,
        );
      }
      return updated;
    });
  }
}

// O ReservationsController pode continuar exatamente do jeito que estava
@Controller('reservations')
export class ReservationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  @Post(':id/cancel') @HttpCode(200) async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CancelDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const reservation = await tx.rideReservation.findFirst({
        where: { id, passengerId: user.id },
      });
      if (!reservation) throw new NotFoundException('Reserva não encontrada.');
      if (reservation.status === ReservationStatus.CANCELLED) return reservation;
      if (reservation.status !== ReservationStatus.CONFIRMED)
        throw new ConflictException('Reserva não pode ser cancelada.');
      const updated = await tx.rideReservation.update({
        where: { id },
        data: { status: ReservationStatus.CANCELLED, cancelledAt: new Date() },
      });
      await tx.ride.update({
        where: { id: reservation.rideId },
        data: { availableSeats: { increment: reservation.seats } },
      });
      await tx.cancellation.create({
        data: { rideId: reservation.rideId, reservationId: id, cancelledByUserId: user.id, ...dto },
      });
      const ride = await tx.ride.findUniqueOrThrow({ where: { id: reservation.rideId } });
      const passenger = await tx.user.findUnique({
        where: { id: user.id },
        select: { fullName: true },
      });
      await this.notifications.create(
        {
          userId: ride.driverId,
          type: NotificationType.RIDE_CANCELLED,
          title: 'Reserva cancelada',
          message: `${passenger?.fullName ?? 'Um passageiro'} cancelou a reserva. A vaga voltou a ficar disponível.`,
          resourceType: 'RIDE',
          resourceId: reservation.rideId,
          metadata: { reservationId: id, passengerId: user.id },
        },
        tx,
      );
      return updated;
    });
  }
}
