import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { PrismaService } from '../../database/prisma.service';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { AchievementsService } from './achievements.service';
import { ProfilePhotoService } from './profile-photo.service';
import { UsersController } from './users.controller';

describe('UsersController.changePassword', () => {
  const currentPassword = 'CurrentPassword1!';
  const newPassword = 'NewPassword1!';
  const user: AuthUser = { id: 'user-id', roles: [] };
  const storedPasswordHash = argon2.hash(currentPassword, { type: argon2.argon2id });
  const prisma = {
    user: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    refreshSession: { updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest
      .fn()
      .mockImplementation((operations: Promise<unknown>[]) => Promise.all(operations)),
  };
  const controller = new UsersController(
    prisma as unknown as PrismaService,
    {} as unknown as AchievementsService,
    {} as unknown as ProfilePhotoService,
  );

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      passwordHash: await storedPasswordHash,
    });
    prisma.user.update.mockResolvedValue({});
    prisma.refreshSession.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.create.mockResolvedValue({});
  });

  it('rejeita senha atual incorreta sem alterar senha, sessões ou auditoria', async () => {
    await expect(
      controller.changePassword(user, {
        currentPassword: 'WrongPassword1!',
        newPassword,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('confirma a senha atual antes de salvar o hash da nova senha', async () => {
    await expect(
      controller.changePassword(user, { currentPassword, newPassword }),
    ).resolves.toEqual({ changed: true });

    const newPasswordHash = prisma.user.update.mock.calls[0][0].data.passwordHash as string;
    await expect(argon2.verify(newPasswordHash, newPassword)).resolves.toBe(true);
    expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: user.id,
        action: 'PASSWORD_CHANGED',
        entityType: 'User',
        entityId: user.id,
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
