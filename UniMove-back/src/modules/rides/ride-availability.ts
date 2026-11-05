import { Prisma } from '../../generated/prisma/client';

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
