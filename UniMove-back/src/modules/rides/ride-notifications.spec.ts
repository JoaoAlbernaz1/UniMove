import type { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import type { PrismaService } from '../../database/prisma.service';
import {
  NotificationType,
  ReservationStatus,
  RideRequestStatus,
  RideStatus,
} from '../../generated/prisma/enums';
import type { NotificationService } from '../notifications/notifications.service';
import { RideRequestsController } from '../ride-requests/ride-requests.controller';
import { ReservationsController, RidesController } from './rides.controller';

const passenger: AuthUser = { id: 'passenger-id', roles: [] };
const driver: AuthUser = { id: 'driver-id', roles: [] };

describe('Ride event notifications', () => {
  const notify = jest.fn();
  const notifyMany = jest.fn();
  const notifications = {
    create: notify,
    createMany: notifyMany,
  } as unknown as NotificationService;

  beforeEach(() => jest.clearAllMocks());

  it('notifies the driver when a passenger requests a ride', async () => {
    const prisma = {
      ride: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ride-id',
          driverId: driver.id,
          status: RideStatus.OPEN,
          availableSeats: 2,
        }),
      },
      rideRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'request-id' }),
      },
    } as unknown as PrismaService;
    const config = {
      get: jest.fn().mockReturnValue(15),
    } as unknown as ConfigService;
    const controller = new RidesController(prisma, config, notifications);

    await controller.request(passenger, 'ride-id', { seats: 1 });

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: driver.id,
        type: NotificationType.RIDE_REQUEST_RECEIVED,
        resourceId: 'request-id',
      }),
    );
  });

  it('notifies the passenger when the driver accepts a request', async () => {
    const request = {
      id: 'request-id',
      rideId: 'ride-id',
      passengerId: passenger.id,
      seatsRequested: 1,
      status: RideRequestStatus.PENDING,
      expiresAt: new Date(Date.now() + 60_000),
      ride: { id: 'ride-id', driverId: driver.id, status: RideStatus.OPEN, availableSeats: 1 },
    };
    const tx = {
      rideRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        findUniqueOrThrow: jest.fn().mockResolvedValue(request),
        update: jest.fn(),
      },
      ride: { update: jest.fn() },
      rideReservation: {
        create: jest.fn().mockResolvedValue({ id: 'reservation-id' }),
        findUnique: jest.fn(),
      },
      messageConversation: { upsert: jest.fn().mockResolvedValue({ id: 'conversation-id' }) },
      $queryRaw: jest.fn(),
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    } as unknown as PrismaService;
    const controller = new RideRequestsController(prisma, notifications);

    await controller.accept(driver, 'request-id');

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: passenger.id,
        type: NotificationType.RIDE_REQUEST_ACCEPTED,
      }),
      tx,
    );
    expect(tx.messageConversation.upsert).toHaveBeenCalledWith({
      where: { rideId_passengerId: { rideId: 'ride-id', passengerId: passenger.id } },
      create: { rideId: 'ride-id', passengerId: passenger.id },
      update: {},
    });
  });

  it('notifies the passenger when the driver rejects a request', async () => {
    const request = {
      id: 'request-id',
      rideId: 'ride-id',
      passengerId: passenger.id,
      status: RideRequestStatus.PENDING,
    };
    const tx = {
      rideRequest: {
        findFirst: jest.fn().mockResolvedValue(request),
        update: jest.fn().mockResolvedValue({ ...request, status: RideRequestStatus.REJECTED }),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    } as unknown as PrismaService;
    const controller = new RideRequestsController(prisma, notifications);

    await controller.reject(driver, 'request-id');

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: passenger.id,
        type: NotificationType.RIDE_REQUEST_REJECTED,
      }),
      tx,
    );
  });

  it('notifies the driver when a passenger cancels a reservation', async () => {
    const reservation = {
      id: 'reservation-id',
      rideId: 'ride-id',
      passengerId: passenger.id,
      seats: 1,
      status: ReservationStatus.CONFIRMED,
    };
    const tx = {
      rideReservation: {
        findFirst: jest.fn().mockResolvedValue(reservation),
        update: jest
          .fn()
          .mockResolvedValue({ ...reservation, status: ReservationStatus.CANCELLED }),
      },
      ride: {
        update: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'ride-id', driverId: driver.id }),
      },
      cancellation: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    } as unknown as PrismaService;
    const controller = new ReservationsController(prisma, notifications);

    await controller.cancel(passenger, 'reservation-id', { reason: 'SCHEDULE_CHANGE' });

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: driver.id,
        type: NotificationType.RIDE_CANCELLED,
      }),
      tx,
    );
  });
});
