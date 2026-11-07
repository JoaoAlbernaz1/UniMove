import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { UserStatus } from '../../generated/prisma/enums';
import { AccountDeletionService } from './account-deletion.service';

describe('AccountDeletionService', () => {
  const userId = 'c90f70f4-5c66-4a14-88e4-d538a84dc26e';
  const currentPassword = 'CurrentPassword1!';
  const passwordHash = argon2.hash(currentPassword, { type: argon2.argon2id });
  const tx = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    user: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    ride: { count: jest.fn(), updateMany: jest.fn() },
    rideRequest: { count: jest.fn() },
    rideReservation: { count: jest.fn() },
    vehicle: { findMany: jest.fn(), update: jest.fn() },
    routeTemplate: { updateMany: jest.fn() },
    messageConversation: { deleteMany: jest.fn() },
    notification: { deleteMany: jest.fn() },
    rating: { updateMany: jest.fn() },
    cancellation: { updateMany: jest.fn() },
    incident: { updateMany: jest.fn() },
    auditLog: { updateMany: jest.fn(), create: jest.fn() },
    academicVerification: { updateMany: jest.fn(), deleteMany: jest.fn() },
    profilePhoto: { deleteMany: jest.fn() },
    driverLicense: { deleteMany: jest.fn() },
    userRole: { deleteMany: jest.fn() },
    refreshSession: { deleteMany: jest.fn() },
    twoFactorAuth: { deleteMany: jest.fn() },
    pushDevice: { deleteMany: jest.fn() },
  };
  const prisma = {
    user: { findUniqueOrThrow: jest.fn() },
    $transaction: jest.fn(),
  };
  const service = new AccountDeletionService(prisma as unknown as PrismaService);

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      passwordHash: await passwordHash,
      status: UserStatus.ACTIVE,
    });
    prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<void>) =>
      callback(tx),
    );
    tx.user.findUniqueOrThrow.mockResolvedValue({ status: UserStatus.ACTIVE });
    tx.user.findUnique.mockResolvedValue({ roles: [] });
    tx.user.count.mockResolvedValue(0);
    tx.ride.count.mockResolvedValue(0);
    tx.rideRequest.count.mockResolvedValue(0);
    tx.rideReservation.count.mockResolvedValue(0);
    tx.vehicle.findMany.mockResolvedValue([]);
  });

  it('exige a senha atual antes de iniciar a exclusão', async () => {
    await expect(service.deleteAccount(userId, 'WrongPassword1!')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('impede que o último administrador válido apague a própria conta', async () => {
    tx.user.findUnique.mockResolvedValue({ roles: [{ role: { name: 'ADMIN' } }] });

    await expect(service.deleteAccount(userId, currentPassword)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('bloqueia exclusão enquanto há compromissos de carona ativos', async () => {
    tx.rideReservation.count.mockResolvedValue(1);

    await expect(service.deleteAccount(userId, currentPassword)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.refreshSession.deleteMany).not.toHaveBeenCalled();
  });

  it('adquire o lock administrativo antes de bloquear e consultar a conta atual', async () => {
    await service.deleteAccount(userId, currentPassword);

    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[0],
    );
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.user.findUniqueOrThrow.mock.invocationCallOrder[0],
    );
  });

  it('remove telefone, segredo e recuperação do 2FA e tokens push na transação', async () => {
    await service.deleteAccount(userId, currentPassword);

    expect(tx.twoFactorAuth.deleteMany).toHaveBeenCalledWith({ where: { userId } });
    expect(tx.pushDevice.deleteMany).toHaveBeenCalledWith({ where: { userId } });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: expect.objectContaining({ phone: null }),
    });
  });

  it('propaga falhas na remoção de segredos para abortar a transação', async () => {
    tx.twoFactorAuth.deleteMany.mockRejectedValueOnce(new Error('Secret deletion failed'));

    await expect(service.deleteAccount(userId, currentPassword)).rejects.toThrow(
      'Secret deletion failed',
    );
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('preserva autoria de decisões sobre terceiros e remove o IP do autor', async () => {
    await service.deleteAccount(userId, currentPassword);

    expect(tx.academicVerification.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.updateMany).toHaveBeenCalledWith({
      where: { actorUserId: userId },
      data: { ip: null },
    });
  });

  it.each([
    { code: 'P2034' },
    { code: 'P2010', meta: { code: '40001' } },
    { code: 'P2010', meta: { code: '40P01' } },
    {
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '40001' } } },
    },
    {
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '40P01' } } },
    },
  ])('traduz conflito concorrente conhecido em 409 ($code/$meta)', async (options) => {
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Synthetic transaction conflict', {
        clientVersion: '7.0.0',
        ...options,
      }),
    );

    await expect(service.deleteAccount(userId, currentPassword)).rejects.toMatchObject({
      status: 409,
      response: { code: 'ACCOUNT_CONCURRENT_UPDATE' },
    });
  });

  it('não oculta falhas transacionais sem relação com concorrência', async () => {
    const error = new Error('Synthetic database failure');
    prisma.$transaction.mockRejectedValueOnce(error);

    await expect(service.deleteAccount(userId, currentPassword)).rejects.toBe(error);
  });

  it('remove dados identificáveis e mantém registros operacionais anonimizados', async () => {
    tx.vehicle.findMany.mockResolvedValue([{ id: 'vehicle-id' }]);

    await expect(service.deleteAccount(userId, currentPassword)).resolves.toBeUndefined();

    expect(tx.profilePhoto.deleteMany).toHaveBeenCalledWith({ where: { userId } });
    expect(tx.driverLicense.deleteMany).toHaveBeenCalledWith({ where: { userId } });
    expect(tx.academicVerification.deleteMany).toHaveBeenCalledWith({ where: { userId } });
    expect(tx.refreshSession.deleteMany).toHaveBeenCalledWith({ where: { userId } });
    expect(tx.vehicle.update).toHaveBeenCalledWith({
      where: { id: 'vehicle-id' },
      data: expect.objectContaining({
        brand: 'Removido',
        model: 'Removido',
        color: 'Removido',
        active: false,
      }),
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: expect.objectContaining({
        fullName: 'Conta excluída',
        institutionalEmail: `deleted+${userId}@deleted.invalid`,
        cpf: `EXCLUIDO-${userId}`,
        studentNumber: null,
        status: UserStatus.DEACTIVATED,
        deletedAt: expect.any(Date),
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: { action: 'USER_ACCOUNT_DELETED', entityType: 'AccountDeletion' },
    });
  });
});
