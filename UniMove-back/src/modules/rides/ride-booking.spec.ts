import type { PrismaService } from '../../database/prisma.service';
import type { ConfigService } from '@nestjs/config';
import type { NotificationService } from '../notifications/notifications.service';
import { RequestRideDto, RidesController } from './rides.controller';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RideQueriesService } from './ride-queries.service';

describe('Ride booking', () => {
  it.each([0, 2, 3, 4, 5, 6, 7, 1.5, '1', null, undefined])(
    'rejects a seat count of %p',
    async (seats) => {
      expect(await validate(plainToInstance(RequestRideDto, { seats }))).not.toHaveLength(0);
    },
  );
  it('accepts exactly one seat', async () => {
    expect(await validate(plainToInstance(RequestRideDto, { seats: 1 }))).toHaveLength(0);
  });
  const passenger = { id: 'passenger', roles: [] };
  const future = () => new Date(Date.now() + 3600000);
  function setup() {
    const ride = {
      id: 'ride',
      driverId: 'driver',
      status: 'OPEN',
      departureAt: future(),
      availableSeats: 2,
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      ride: {
        findUnique: jest.fn().mockResolvedValue(ride),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      rideRequest: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { seatsRequested: 1 } }),
        create: jest.fn().mockResolvedValue({ id: 'request', status: 'PENDING' }),
      },
    };
    const prisma = { $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)) };
    const notifications = { create: jest.fn() };
    const controller = new RidesController(
      prisma as unknown as PrismaService,
      { get: () => 15 } as unknown as ConfigService,
      notifications as unknown as NotificationService,
    );
    return { controller, tx, ride, notifications };
  }

  it('holds only free seats, locks passenger and ride and notifies in the same transaction', async () => {
    const { controller, tx, notifications } = setup();
    await controller.request(passenger, 'ride', { seats: 1 });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.rideRequest.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PENDING', expiresAt: { gt: expect.any(Date) } }),
      }),
    );
    const data = tx.rideRequest.create.mock.calls[0][0].data;
    expect(data.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60000);
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'driver' }),
      tx,
    );
  });

  it('rejects overbooking when the last seat is already held', async () => {
    const { controller, tx } = setup();
    tx.rideRequest.aggregate.mockResolvedValue({ _sum: { seatsRequested: 2 } });
    await expect(controller.request(passenger, 'ride', { seats: 1 })).rejects.toThrow('esgotar');
    expect(tx.rideRequest.create).not.toHaveBeenCalled();
  });

  it('rejects another pending request, confirmed reservation or driven ride at the same minute', async () => {
    const { controller, tx } = setup();
    tx.ride.findFirst.mockResolvedValue({ id: 'other-ride' });
    await expect(controller.request(passenger, 'ride', { seats: 1 })).rejects.toThrow(
      'neste horário',
    );
    expect(tx.ride.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ driverId: passenger.id }),
            expect.objectContaining({ reservations: expect.any(Object) }),
            expect.objectContaining({ requests: expect.any(Object) }),
          ]),
        }),
      }),
    );
    expect(tx.rideRequest.create).not.toHaveBeenCalled();
  });

  it.each(['CANCELLED', 'COMPLETED', 'IN_PROGRESS'])('rejects a %s ride', async (status) => {
    const { controller, ride } = setup();
    ride.status = status;
    await expect(controller.request(passenger, 'ride', { seats: 1 })).rejects.toThrow(
      'não está aberta',
    );
  });

  it('rejects past departures and self booking', async () => {
    const { controller, ride } = setup();
    ride.driverId = passenger.id;
    await expect(controller.request(passenger, 'ride', { seats: 1 })).rejects.toThrow(
      'própria carona',
    );
    ride.driverId = 'driver';
    ride.departureAt = new Date(0);
    await expect(controller.request(passenger, 'ride', { seats: 1 })).rejects.toThrow(
      'não está aberta',
    );
  });

  it('caps the hold at departure and supports scheduled rides', async () => {
    const { controller, ride, tx } = setup();
    ride.status = 'SCHEDULED';
    ride.departureAt = new Date(Date.now() + 60000);
    await controller.request(passenger, 'ride', { seats: 1 });
    expect(tx.rideRequest.create.mock.calls[0][0].data.expiresAt).toEqual(ride.departureAt);
  });

  it('reports an expired request without waiting for the driver to open their inbox', async () => {
    const prisma = {
      ride: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ride',
          driverId: 'driver',
          status: 'OPEN',
          departureAt: future(),
          requests: [{ status: 'PENDING', expiresAt: new Date(0) }],
        }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ availableSeats: 1 }]),
    };
    const details = await new RideQueriesService(prisma as unknown as PrismaService).details(
      'ride',
      passenger.id,
    );
    expect(details.request?.status).toBe('EXPIRED');
    expect(details.canRequest).toBe(true);
    expect(details).not.toHaveProperty('requests');
  });
});
