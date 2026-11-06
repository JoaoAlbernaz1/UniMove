import { Prisma } from '../../generated/prisma/client';

export function activePendingRequestWhere(passengerId: string, now: Date): Prisma.RideRequestWhereInput {
  return {
    passengerId, status: 'PENDING', expiresAt: { gt: now },
    ride: { status: { in: ['OPEN', 'SCHEDULED'] }, departureAt: { gt: now } },
  };
}

// available_seats stores seats left after confirmed reservations. Pending requests
// hold seats only until expires_at; no scheduled job is needed to release them.
export const availableSeatsSql = Prisma.sql`GREATEST(0, r.available_seats - COALESCE((
  SELECT SUM(rr.seats_requested) FROM ride_requests rr
  WHERE rr.ride_id = r.id AND rr.status = 'PENDING' AND rr.expires_at > NOW()
), 0))::int`;

export async function heldSeats(tx: Prisma.TransactionClient, rideId: string, now: Date) {
  const pending = await tx.rideRequest.aggregate({
    where: { rideId, status: 'PENDING', expiresAt: { gt: now } },
    _sum: { seatsRequested: true },
  });
  return pending._sum.seatsRequested ?? 0;
}

// Mesma regra para uma lista de caronas, em uma consulta só. O painel
// administrativo mostra as listas paginadas e precisa do mesmo número que o
// estudante vê no aplicativo; sem isto o admin veria a vaga que já está retida.
export async function heldSeatsByRide(
  tx: Prisma.TransactionClient,
  rideIds: string[],
  now: Date,
): Promise<Map<string, number>> {
  if (!rideIds.length) return new Map();
  const pending = await tx.rideRequest.groupBy({
    by: ['rideId'],
    where: { rideId: { in: rideIds }, status: 'PENDING', expiresAt: { gt: now } },
    _sum: { seatsRequested: true },
  });
  return new Map(pending.map((row) => [row.rideId, row._sum.seatsRequested ?? 0]));
}

/** Vagas que o aplicativo anuncia: as livres menos as retidas por solicitação pendente. */
export const seatsOnOffer = (availableSeats: number, held = 0) =>
  Math.max(0, availableSeats - held);
