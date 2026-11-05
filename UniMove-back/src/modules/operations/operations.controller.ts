import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../database/prisma.service';
import { IncidentType, ReservationStatus, RideStatus } from '../../generated/prisma/enums';

class IncidentDto {
  @IsUUID() rideId!: string;
  @IsOptional() @IsUUID() reportedUserId?: string;
  @IsEnum(IncidentType) type!: IncidentType;
  @IsString() description!: string;
}

@Controller('incidents')
export class IncidentsController {
  constructor(private readonly prisma: PrismaService) {}
  @Post() create(@CurrentUser() user: AuthUser, @Body() dto: IncidentDto) {
    return this.prisma.incident.create({ data: { ...dto, reportedById: user.id } });
  }
}

@Controller('history')
export class HistoryController {
  constructor(private readonly prisma: PrismaService) {}
  @Get() list(@CurrentUser() user: AuthUser, @Query() page: PaginationDto) {
    return this.prisma.ride.findMany({
      where: { OR: [{ driverId: user.id }, { reservations: { some: { passengerId: user.id } } }] },
      include: {
        originLocation: true,
        destinationLocation: true,
        driver: { select: { id: true, fullName: true } },
        reservations: { include: { passenger: { select: { id: true, fullName: true } } } },
        ratings: { where: { OR: [{ reviewerId: user.id }, { reviewedUserId: user.id }] } },
      },
      orderBy: { departureAt: 'desc' },
      skip: (page.page - 1) * page.limit,
      take: page.limit,
    });
  }

  // Totais do histórico. Ganhos e gastos contam só viagens concluídas: uma
  // carona futura ainda não virou dinheiro. O total acompanha a lista acima.
  @Get('summary') async summary(@CurrentUser() user: AuthUser) {
    const paid = { in: [ReservationStatus.CONFIRMED, ReservationStatus.COMPLETED] };
    const [totalRides, drivenRides, reservations] = await Promise.all([
      this.prisma.ride.count({
        where: {
          OR: [{ driverId: user.id }, { reservations: { some: { passengerId: user.id } } }],
        },
      }),
      this.prisma.ride.findMany({
        where: { driverId: user.id, status: RideStatus.COMPLETED },
        select: {
          pricePerPersonCents: true,
          reservations: { where: { status: paid }, select: { seats: true } },
        },
      }),
      this.prisma.rideReservation.findMany({
        where: { passengerId: user.id, status: paid, ride: { status: RideStatus.COMPLETED } },
        select: { seats: true, ride: { select: { pricePerPersonCents: true } } },
      }),
    ]);

    const seatsTaken = (rows: { seats: number }[]) => rows.reduce((total, r) => total + r.seats, 0);
    return {
      totalRides,
      earningsCents: drivenRides.reduce(
        (total, ride) => total + ride.pricePerPersonCents * seatsTaken(ride.reservations),
        0,
      ),
      spendingCents: reservations.reduce(
        (total, r) => total + r.ride.pricePerPersonCents * r.seats,
        0,
      ),
    };
  }
}
