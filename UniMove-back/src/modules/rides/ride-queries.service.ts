import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { ReservationStatus, RideStatus } from '../../generated/prisma/enums';
import { SearchRidesDto } from './search-rides.dto';
import { activePendingRequestWhere, availableSeatsSql } from './ride-availability';

const rideInclude = {
  driver: { select: { id: true, fullName: true } },
  vehicle: { select: { brand: true, model: true } },
  originLocation: { select: { name: true, latitude: true, longitude: true } },
  destinationLocation: { select: { name: true, latitude: true, longitude: true } },
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

  async search(query: SearchRidesDto, userId?: string) {
    this.validateDate(query.date);
    const pending = userId ? await this.prisma.rideRequest.findMany({
      where: activePendingRequestWhere(userId, new Date()), select: { rideId: true },
    }) : [];
    const pendingRideIds = new Set(pending.map(({ rideId }) => rideId));
    const conditions: Prisma.Sql[] = [
      Prisma.sql`r.status IN ('OPEN', 'SCHEDULED')`,
      Prisma.sql`r.departure_at > NOW()`,
      pending.length
        ? Prisma.sql`(${availableSeatsSql} > 0 OR r.id IN (${Prisma.join(pending.map(({ rideId }) => Prisma.sql`${rideId}::uuid`))}))`
        : Prisma.sql`${availableSeatsSql} > 0`,
      Prisma.sql`(
        EXISTS (
          SELECT 1
          FROM academic_verifications av
          WHERE av.user_id = r.driver_id
            AND av.status = 'APPROVED'
        ) OR EXISTS (
          SELECT 1
          FROM user_roles ur
          JOIN roles role ON role.id = ur.role_id
          WHERE ur.user_id = r.driver_id
            AND role.name = 'ADMIN'
        )
      )`,
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
    const ids = await this.prisma.$queryRaw<
      { id: string; availableSeats: number }[]
    >(
      Prisma.sql`SELECT r.id, ${availableSeatsSql} AS "availableSeats" ${from} ORDER BY r.departure_at ASC, r.id ASC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
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
    const byDriver = new Map(
      ratings.map((rating) => [rating.reviewedUserId, rating]),
    );
    return {
      items: rides.map((ride) => ({
        ...ride,
        availableSeats: ids.find(({ id }) => id === ride.id)!.availableSeats,
        requestStatus: pendingRideIds.has(ride.id) ? 'PENDING' : null,
        canRequest: pending.length === 0 && ride.driverId !== userId && ids.find(({ id }) => id === ride.id)!.availableSeats > 0,
        driver: {
          ...ride.driver,
          ratingAverage: byDriver.get(ride.driverId)?._avg.score ?? null,
          ratingCount: byDriver.get(ride.driverId)?._count.score ?? 0,
        },
      })),
      total: counts[0]?.total ?? 0,
      hasPendingRequest: pending.length > 0,
      page: query.page,
      limit: query.limit,
    };
  }

  async details(id: string, userId: string) {
    const ride = await this.prisma.ride.findUnique({
      where: { id },
      include: {
        ...rideInclude,
        vehicle: {
          select: { brand: true, model: true, color: true, year: true },
        },
        requests: {
          where: { passengerId: userId },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            seatsRequested: true,
            expiresAt: true,
            reservation: { select: { status: true } },
          },
        },
      },
    });
    if (!ride) throw new NotFoundException('Carona não encontrada.');
    const now = new Date();
    const pendingRequest = await this.prisma.rideRequest.findFirst({
      where: activePendingRequestWhere(userId, now), select: { id: true },
    });
    const availability = await this.prisma.$queryRaw<
      { availableSeats: number }[]
    >(
      Prisma.sql`SELECT ${availableSeatsSql} AS "availableSeats" FROM rides r WHERE r.id = ${id}::uuid`,
    );
    const lastRequest = ride.requests[0];
    const request = lastRequest
      ? {
          ...lastRequest,
          status:
            lastRequest.status === 'PENDING' &&
            (lastRequest.expiresAt <= now ||
              !['OPEN', 'SCHEDULED'].includes(ride.status))
              ? 'EXPIRED'
              : lastRequest.status,
        }
      : null;
    const availableSeats = availability[0]?.availableSeats ?? 0;
    const blocked =
      request?.status === 'PENDING' ||
      request?.reservation?.status === 'CONFIRMED';
    const { requests: _requests, ...details } = ride;
    return {
      ...details,
      availableSeats,
      request,
      hasPendingRequest: !!pendingRequest,
      canRequest:
        !blocked &&
        !pendingRequest &&
        ride.driverId !== userId &&
        ride.departureAt > now &&
        ['OPEN', 'SCHEDULED'].includes(ride.status) &&
        availableSeats > 0,
      isDriver: ride.driverId === userId,
    };
  }

  async upcoming(userId: string) {
    const rides = await this.prisma.ride.findMany({
      where: {
        status: { in: [RideStatus.OPEN, RideStatus.SCHEDULED] },
        departureAt: { gte: new Date() },
        OR: [
          { driverId: userId },
          {
            reservations: {
              some: {
                passengerId: userId,
                status: ReservationStatus.CONFIRMED,
              },
            },
          },
        ],
      },
      include: {
        ...rideInclude,
        reservations: {
          where: { passengerId: userId, status: ReservationStatus.CONFIRMED },
        },
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
      throw new BadRequestException(
        'Informe uma data válida no formato dd/mm/aaaa.',
      );
  }
}
