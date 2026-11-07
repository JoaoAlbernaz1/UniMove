import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service';
import { RoleName, UserStatus } from '../../generated/prisma/enums';
import type { NotificationService } from '../notifications/notifications.service';
import { AdminUsersService, maskPlate } from './admin-users.service';

describe('AdminUsersService.changeStatus', () => {
  const actor = { id: 'admin-id', roles: [RoleName.ADMIN], mfa: true };
  const tx = {
    $executeRaw: jest.fn(),
    user: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn() },
    ride: { count: jest.fn(), findMany: jest.fn() },
    rideReservation: { count: jest.fn(), findMany: jest.fn() },
    rideRequest: { count: jest.fn(), updateMany: jest.fn() },
    refreshSession: { updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const notifications = { createMany: jest.fn() };
  const service = new AdminUsersService(
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationService,
  );
  const usersById = (target: unknown, actorRow?: unknown) =>
    tx.user.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(
        where.id === actor.id
          ? (actorRow ?? {
              status: UserStatus.ACTIVE,
              roles: [{ role: { name: RoleName.ADMIN } }],
            })
          : { roles: [], ...(target as object) },
      ),
    );
  const dto = { status: UserStatus.SUSPENDED, reason: 'Motivo de teste' };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.ride.count.mockResolvedValue(0);
    tx.ride.findMany.mockResolvedValue([]);
    tx.rideReservation.count.mockResolvedValue(0);
    tx.rideReservation.findMany.mockResolvedValue([]);
    tx.rideRequest.count.mockResolvedValue(0);
    tx.rideRequest.updateMany.mockResolvedValue({ count: 0 });
    tx.user.count.mockResolvedValue(1);
    tx.user.update.mockResolvedValue({ id: 'target', status: dto.status });
  });

  it('recusa alterar a própria conta sem abrir transação', async () => {
    await expect(service.changeStatus(actor, actor.id, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('recusa quando o próprio administrador perdeu o acesso enquanto aguardava o lock', async () => {
    usersById({ status: UserStatus.ACTIVE, deletedAt: null }, { status: 'SUSPENDED', roles: [] });
    await expect(service.changeStatus(actor, 'target', dto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it.each([
    ['excluída', { status: UserStatus.ACTIVE, deletedAt: new Date() }],
    ['desativada', { status: UserStatus.DEACTIVATED, deletedAt: null }],
  ])('não reativa conta %s', async (_label, target) => {
    usersById(target);
    await expect(
      service.changeStatus(actor, 'target', { status: UserStatus.ACTIVE, reason: 'Reativar' }),
    ).rejects.toMatchObject({ response: { code: 'ACCOUNT_DEACTIVATED' } });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('pede confirmação quando há compromissos, sem alterar nada', async () => {
    usersById({ status: UserStatus.ACTIVE, deletedAt: null });
    tx.rideReservation.count.mockResolvedValue(2);
    await expect(service.changeStatus(actor, 'target', dto)).rejects.toMatchObject({
      response: { code: 'IMPACT_CONFIRMATION_REQUIRED' },
    });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('audita motivo e revoga sessões na mesma transação, sem devolver dados sensíveis', async () => {
    usersById({ status: UserStatus.ACTIVE, deletedAt: null });
    await service.changeStatus(actor, 'target', dto);
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({ cpf: true, passwordHash: true }),
      }),
    );
    expect(tx.refreshSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'target', revokedAt: null } }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: actor.id,
        action: 'ADMIN_USER_SUSPENDED',
        metadata: expect.objectContaining({ reason: dto.reason, previousStatus: 'ACTIVE' }),
      }),
    });
  });

  it('reativar não revoga sessões nem procura compromissos', async () => {
    usersById({ status: UserStatus.SUSPENDED, deletedAt: null });
    await service.changeStatus(actor, 'target', { status: UserStatus.ACTIVE, reason: 'Revisado' });
    expect(tx.refreshSession.updateMany).not.toHaveBeenCalled();
    expect(tx.ride.findMany).not.toHaveBeenCalled();
  });

  it('falha ao notificar não desfaz a decisão, mas é informada', async () => {
    usersById({ status: UserStatus.ACTIVE, deletedAt: null });
    tx.ride.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    tx.rideReservation.findMany.mockResolvedValue([
      { id: 'r', rideId: 'ride', seats: 1, ride: { driverId: 'driver' } },
    ]);
    Object.assign(tx.rideReservation, { update: jest.fn() });
    Object.assign(tx.ride, { update: jest.fn() });
    Object.assign(tx, { cancellation: { create: jest.fn() } });
    tx.rideReservation.count.mockResolvedValue(1);
    notifications.createMany.mockRejectedValue(new Error('SMTP fora'));

    const result = await service.changeStatus(actor, 'target', { ...dto, confirmImpact: true });

    expect(result.notificationsDelivered).toBe(false);
    expect(tx.user.update).toHaveBeenCalled();
  });
});

describe('maskPlate', () => {
  it('mantém só o suficiente para reconhecer o veículo', () => {
    expect(maskPlate('QWE4F21')).toBe('Q••••21');
    expect(maskPlate('AB')).toBe('•••');
  });
});
