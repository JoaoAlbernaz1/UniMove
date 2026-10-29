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
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../database/prisma.service';
import {
  NotificationType,
  ReservationStatus,
  RideRequestStatus,
  RideStatus,
} from '../../generated/prisma/enums';
import { NotificationService } from '../notifications/notifications.service';

class RequestRideDto {
  @IsInt() @Min(1) @Max(8) seats!: number;
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
  async request(
    @CurrentUser() user: AuthUser,
    @Param('rideId') rideId: string,
    @Body() dto: RequestRideDto,
  ) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.status !== RideStatus.OPEN)
      throw new ConflictException('Carona não está aberta.');
    if (ride.driverId === user.id)
      throw new ConflictException('Motorista não pode solicitar a própria carona.');
    if (ride.availableSeats < dto.seats) throw new ConflictException('Não há vagas disponíveis.');
    
    const duplicate = await this.prisma.rideRequest.findFirst({
      where: { rideId, passengerId: user.id, status: RideRequestStatus.PENDING },
    });
    if (duplicate) throw new ConflictException('Já existe solicitação pendente para esta carona.');
    
    const request = await this.prisma.rideRequest.create({
      data: {
        rideId,
        passengerId: user.id,
        seatsRequested: dto.seats,
        expiresAt: new Date(
          Date.now() + this.config.get<number>('rides.requestExpirationMinutes')! * 60000,
        ),
      },
    });
    
    await this.notifications.create({
      userId: ride.driverId,
      type: NotificationType.RIDE_REQUEST_RECEIVED,
      title: 'Nova solicitação',
      message: 'Um passageiro solicitou vaga na sua carona.',
      resourceType: 'RIDE_REQUEST',
      resourceId: request.id,
      metadata: { rideId, passengerId: user.id },
    });
    
    return request;
  }

  @Get('me') 
  async mine(@CurrentUser() user: AuthUser, @Query() query: MyRidesQuery) {
    const where =
      query.role === 'driver'
        ? { driverId: user.id }
        : query.role === 'passenger'
          ? { reservations: { some: { passengerId: user.id } } }
          : { OR: [{ driverId: user.id }, { reservations: { some: { passengerId: user.id } } }] };
    
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
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CancelDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const ride = await tx.ride.findFirst({ where: { id, driverId: user.id } });
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
      
      await tx.cancellation.create({ data: { rideId: id, cancelledByUserId: user.id, ...dto } });
      
      if (reservations.length)
        await this.notifications.createMany(
          reservations.map((r) => ({
            userId: r.passengerId,
            type: NotificationType.RIDE_CANCELLED,
            title: 'Carona cancelada',
            message: 'O motorista cancelou a carona.',
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
                ? 'O motorista iniciou a carona.'
                : 'A carona foi concluída.',
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
            message: 'A carona foi concluída.',
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
      await this.notifications.create(
        {
          userId: ride.driverId,
          type: NotificationType.RIDE_CANCELLED,
          title: 'Reserva cancelada',
          message: 'Um passageiro cancelou a reserva.',
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
