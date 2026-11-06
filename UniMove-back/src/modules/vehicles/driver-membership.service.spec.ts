import type { PrismaService } from '../../database/prisma.service';
import { DriverMembershipService } from './driver-membership.service';

describe('Leaving driver membership', () => {
  function setup(activeRides = 0) {
    const tx = {
      $queryRaw: jest.fn(),
      ride: { count: jest.fn().mockResolvedValue(activeRides) },
      vehicle: { updateMany: jest.fn() },
      routeTemplate: { updateMany: jest.fn() },
      userRole: { deleteMany: jest.fn(), upsert: jest.fn() },
      role: { upsert: jest.fn().mockResolvedValue({ id: 'passenger-role' }) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    return { service: new DriverMembershipService(prisma as unknown as PrismaService), tx };
  }

  it('soft deletes only the caller vehicles and routes, removes DRIVER and retains PASSENGER', async () => {
    const { service, tx } = setup();
    await service.leave('user-id');
    expect(tx.vehicle.updateMany).toHaveBeenCalledWith({
      where: { ownerId: 'user-id', active: true },
      data: { active: false },
    });
    expect(tx.routeTemplate.updateMany).toHaveBeenCalledWith({
      where: { driverId: 'user-id', active: true },
      data: { active: false },
    });
    expect(tx.userRole.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-id', role: { name: 'DRIVER' } },
    });
    expect(tx.userRole.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { userId: 'user-id', roleId: 'passenger-role' } }),
    );
  });

  it('blocks leaving while rides are open or in progress without deactivating data', async () => {
    const { service, tx } = setup(1);
    await expect(service.leave('user-id')).rejects.toThrow('Cancele ou conclua');
    expect(tx.ride.count).toHaveBeenCalledWith({
      where: { driverId: 'user-id', status: { in: ['OPEN', 'SCHEDULED', 'IN_PROGRESS'] } },
    });
    expect(tx.vehicle.updateMany).not.toHaveBeenCalled();
    expect(tx.userRole.deleteMany).not.toHaveBeenCalled();
  });
});
