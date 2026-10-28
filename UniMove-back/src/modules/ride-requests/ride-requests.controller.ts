import {
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { IsOptional } from 'class-validator';
import { CurrentUser, Roles } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { PrismaService } from '../../database/prisma.service';
import {
  NotificationType,
  RideRequestStatus,
  RideStatus,
  RoleName,
} from '../../generated/prisma/enums';
import { NotificationService } from '../notifications/notifications.service';

class RequestFilterDto {
  @IsOptional() status?: RideRequestStatus;
}

@Controller('driver/ride-requests')
@Roles(RoleName.DRIVER)
export class DriverRequestsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}
  @Get() async list(@CurrentUser() user: AuthUser, @Query() query: RequestFilterDto) {
    const expired = await this.prisma.rideRequest.findMany({
      where: {
        ride: { driverId: user.id },
        status: RideRequestStatus.PENDING,
        expiresAt: { lte: new Date() },
      },
    });
    if (expired.length) {
      await this.prisma.$transaction(async (tx) => {
        await tx.rideRequest.updateMany({
          where: { id: { in: expired.map((request) => request.id) } },
          data: { status: RideRequestStatus.EXPIRED, respondedAt: new Date() },
        });
        await this.notifications.createMany(
          expired.map((request) => ({
            userId: request.passengerId,
            type: NotificationType.RIDE_REQUEST_EXPIRED,
            title: 'Solicitação expirada',
            message: 'Sua solicitação de carona expirou.',
            resourceType: 'RIDE_REQUEST',
            resourceId: request.id,
            metadata: { rideId: request.rideId },
          })),
          tx,
        );
      });
    }
    return this.prisma.rideRequest.findMany({
      where: { ride: { driverId: user.id }, ...(query.status ? { status: query.status } : {}) },
      include: { ride: true, passenger: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}

@Controller('ride-requests')
@Roles(RoleName.DRIVER)
export class RideRequestsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}
  @Post(':id/accept') async accept(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const initial = await tx.rideRequest.findUnique({ where: { id } });
        if (!initial) throw new NotFoundException('Solicitação não encontrada.');
        await tx.$queryRaw`SELECT id FROM rides WHERE id = ${initial.rideId}::uuid FOR UPDATE`;
        const request = await tx.rideRequest.findUniqueOrThrow({
          where: { id },
          include: { ride: true },
        });
        if (request.ride.driverId !== user.id)
          throw new NotFoundException('Solicitação não encontrada.');
        if (request.status === RideRequestStatus.ACCEPTED)
          return tx.rideReservation.findUnique({ where: { requestId: id } });
        if (request.status !== RideRequestStatus.PENDING || request.expiresAt <= new Date())
          throw new ConflictException('Solicitação não está pendente.');
        if (
          request.ride.status !== RideStatus.OPEN ||
          request.ride.availableSeats < request.seatsRequested
        )
          throw new ConflictException('Não há vagas disponíveis nesta carona.');
        await tx.ride.update({
          where: { id: request.rideId },
          data: { availableSeats: { decrement: request.seatsRequested } },
        });
        await tx.rideRequest.update({
          where: { id },
          data: { status: RideRequestStatus.ACCEPTED, respondedAt: new Date() },
        });
        const reservation = await tx.rideReservation.create({
          data: {
            rideId: request.rideId,
            passengerId: request.passengerId,
            requestId: id,
            seats: request.seatsRequested,
          },
        });
        await tx.messageConversation.upsert({
          where: {
            rideId_passengerId: {
              rideId: request.rideId,
              passengerId: request.passengerId,
            },
          },
          create: { rideId: request.rideId, passengerId: request.passengerId },
          update: {},
        });
        await this.notifications.create(
          {
            userId: request.passengerId,
            type: NotificationType.RIDE_REQUEST_ACCEPTED,
            title: 'Solicitação aceita',
            message: 'Sua vaga foi confirmada.',
            resourceType: 'RIDE_REQUEST',
            resourceId: request.id,
            metadata: { rideId: request.rideId, reservationId: reservation.id },
          },
          tx,
        );
        return reservation;
      },
      { isolationLevel: 'Serializable' },
    );
  }
  @Post(':id/reject') async reject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.rideRequest.findFirst({
        where: { id, ride: { driverId: user.id } },
      });
      if (!request) throw new NotFoundException('Solicitação não encontrada.');
      if (request.status === RideRequestStatus.REJECTED) return request;
      if (request.status !== RideRequestStatus.PENDING)
        throw new ConflictException('Solicitação não está pendente.');
      const updated = await tx.rideRequest.update({
        where: { id },
        data: { status: RideRequestStatus.REJECTED, respondedAt: new Date() },
      });
      await this.notifications.create(
        {
          userId: request.passengerId,
          type: NotificationType.RIDE_REQUEST_REJECTED,
          title: 'Solicitação recusada',
          message: 'O motorista recusou sua solicitação.',
          resourceType: 'RIDE_REQUEST',
          resourceId: request.id,
          metadata: { rideId: request.rideId },
        },
        tx,
      );
      return updated;
    });
  }
}
