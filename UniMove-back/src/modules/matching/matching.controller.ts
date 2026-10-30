import { MAX_PASSENGER_CAPACITY } from '../vehicles/vehicle-policy';
import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsUUID, Matches, Max, Min } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { Weekday } from '../../generated/prisma/enums';

class SearchDto {
  @IsUUID() originLocationId!: string;
  @IsUUID() destinationLocationId!: string;
  @IsDateString() date!: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) departureTime!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(MAX_PASSENGER_CAPACITY) seats = 1;
}
const weekdays: Weekday[] = [
  Weekday.SUNDAY,
  Weekday.MONDAY,
  Weekday.TUESDAY,
  Weekday.WEDNESDAY,
  Weekday.THURSDAY,
  Weekday.FRIDAY,
  Weekday.SATURDAY,
];

@Controller('matching')
export class MatchingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}
  @Get('search') async search(@Query() dto: SearchDto) {
    const desiredMinutes = this.minutes(dto.departureTime);
    const tolerance = this.config.get<number>('matching.toleranceMinutes')!;
    const weekday = weekdays[new Date(`${dto.date}T12:00:00Z`).getUTCDay()];
    const routes = await this.prisma.routeTemplate.findMany({
      where: {
        active: true,
        driver: { driverLicense: { isNot: null } },
        originLocationId: dto.originLocationId,
        destinationLocationId: dto.destinationLocationId,
        availableSeats: { gte: dto.seats },
        weekdays: { some: { weekday } },
      },
      include: { driver: true, vehicle: true, originLocation: true, destinationLocation: true },
    });
    const compatible = routes.filter(
      (route) => Math.abs(this.minutes(route.departureTime) - desiredMinutes) <= tolerance,
    );
    const rides = await Promise.all(
      compatible.map((route) =>
        this.prisma.ride.upsert({
          where: {
            routeTemplateId_departureAt: {
              routeTemplateId: route.id,
              departureAt: new Date(`${dto.date}T${route.departureTime}:00-03:00`),
            },
          },
          update: {},
          create: {
            routeTemplateId: route.id,
            driverId: route.driverId,
            vehicleId: route.vehicleId,
            originLocationId: route.originLocationId,
            destinationLocationId: route.destinationLocationId,
            departureAt: new Date(`${dto.date}T${route.departureTime}:00-03:00`),
            totalSeats: route.availableSeats,
            availableSeats: route.availableSeats,
          },
          include: {
            driver: { select: { id: true, fullName: true } },
            vehicle: true,
            originLocation: true,
            destinationLocation: true,
          },
        }),
      ),
    );
    return rides
      .filter((ride) => ride.availableSeats >= dto.seats)
      .sort(
        (a, b) =>
          Math.abs(
            this.minutes(
              a.departureAt.toLocaleTimeString('pt-BR', {
                timeZone: 'America/Sao_Paulo',
                hour: '2-digit',
                minute: '2-digit',
              }),
            ) - desiredMinutes,
          ) -
            Math.abs(
              this.minutes(
                b.departureAt.toLocaleTimeString('pt-BR', {
                  timeZone: 'America/Sao_Paulo',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              ) - desiredMinutes,
            ) || a.id.localeCompare(b.id),
      );
  }
  private minutes(value: string) {
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
  }
}
