import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { ReservationStatus, RideStatus } from '../../generated/prisma/enums';
import { SearchRidesDto } from './search-rides.dto';

const rideInclude = {
  driver: { select: { id: true, fullName: true } },
  vehicle: { select: { brand: true, model: true } },
  originLocation: { select: { name: true } },
  destinationLocation: { select: { name: true } },
} satisfies Prisma.RideInclude;

function normalized(value = '') {
  return value
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

@Injectable()
export class RideQueriesService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: SearchRidesDto) {
    this.validateDate(query.date);
    const conditions: Prisma.Sql[] = [
      Prisma.sql`r.status IN ('OPEN', 'SCHEDULED')`,
      Prisma.sql`r.departure_at > NOW()`,
      Prisma.sql`r.available_seats > 0`,
    ];
    if (query.origin?.trim())
      conditions.push(
        Prisma.sql`position(${normalized(query.origin)} in translate(lower(o.name), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')) > 0`,
      );
    if (query.destination?.trim())
      conditions.push(
        Prisma.sql`position(${normalized(query.destination)} in translate(lower(d.name), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')) > 0`,
      );
    if (query.date)
      conditions.push(
        Prisma.sql`to_char(r.departure_at AT TIME ZONE ${query.timezone}, 'DD/MM/YYYY') = ${query.date}`,
      );
    if (query.time)
      conditions.push(
        Prisma.sql`to_char(r.departure_at AT TIME ZONE ${query.timezone}, 'HH24:MI') = ${query.time}`,
      );
    const from = Prisma.sql`FROM rides r JOIN locations o ON o.id = r.origin_location_id JOIN locations d ON d.id = r.destination_location_id WHERE ${Prisma.join(conditions, ' AND ')}`;
    const counts = await this.prisma.$queryRaw<{ total: number }[]>(
      Prisma.sql`SELECT count(*)::int AS total ${from}`,
    );
    const ids = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT r.id ${from} ORDER BY r.departure_at ASC, r.id ASC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
    );
    const rides = ids.length
      ? await this.prisma.ride.findMany({
          where: { id: { in: ids.map(({ id }) => id) } },
          include: rideInclude,
          orderBy: [{ departureAt: 'asc' }, { id: 'asc' }],
        })
      : [];
    const driverIds = [...new Set(rides.map((ride) => ride.driverId))];
    const ratings = driverIds.length
      ? await this.prisma.rating.groupBy({
          by: ['reviewedUserId'],
          where: { reviewedUserId: { in: driverIds } },
          _avg: { score: true },
          _count: { score: true },
        })
      : [];
    const byDriver = new Map(ratings.map((rating) => [rating.reviewedUserId, rating]));
    return {
      items: rides.map((ride) => ({
        ...ride,
        driver: {
          ...ride.driver,
          ratingAverage: byDriver.get(ride.driverId)?._avg.score ?? null,
          ratingCount: byDriver.get(ride.driverId)?._count.score ?? 0,
        },
      })),
      total: counts[0]?.total ?? 0,
      page: query.page,
      limit: query.limit,
    };
  }

  async upcoming(userId: string) {
    const rides = await this.prisma.ride.findMany({
      where: {
        status: { in: [RideStatus.OPEN, RideStatus.SCHEDULED] },
        departureAt: { gte: new Date() },
        OR: [
          { driverId: userId },
          { reservations: { some: { passengerId: userId, status: ReservationStatus.CONFIRMED } } },
        ],
      },
      include: {
        ...rideInclude,
        reservations: { where: { passengerId: userId, status: ReservationStatus.CONFIRMED } },
      },
      orderBy: [{ departureAt: 'asc' }, { id: 'asc' }],
      take: 3,
    });
    return rides.map(({ reservations, ...ride }) => ({
      ...ride,
      participationRole: ride.driverId === userId ? 'DRIVER' : 'PASSENGER',
      reservedSeats: reservations[0]?.seats ?? 0,
    }));
  }

  private validateDate(value?: string) {
    if (!value) return;
    const [day, month, year] = value.split('/').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    )
      throw new BadRequestException('Informe uma data válida no formato dd/mm/aaaa.');
  }
}
