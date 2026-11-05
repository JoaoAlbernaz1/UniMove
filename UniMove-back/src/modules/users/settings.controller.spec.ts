jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'SEGREDOFICTICIO'),
  generateURI: jest.fn(() => 'otpauth://totp/test'),
  verify: jest.fn().mockResolvedValue({ valid: true }),
}));

import * as argon2 from 'argon2';
import type { PrismaService } from '../../database/prisma.service';
import { RoleName } from '../../generated/prisma/enums';
import { encryptTwoFactorSecret } from '../auth/two-factor-crypto';
import { SettingsController } from './settings.controller';

describe('SettingsController second-factor boundaries', () => {
  const prisma = {
    user: { findUniqueOrThrow: jest.fn() },
    twoFactorAuth: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const controller = new SettingsController(prisma as unknown as PrismaService);
  const student = { id: 'student', roles: [RoleName.PASSENGER] };
  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.TWO_FACTOR_ENCRYPTION_KEY = 'dedicated-fixture-key-with-at-least-32-characters';
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      institutionalEmail: 'student@ucb.edu.br',
      passwordHash: await argon2.hash('password'),
      roles: [{ role: { name: RoleName.PASSENGER } }],
    });
    prisma.twoFactorAuth.findUnique.mockResolvedValue(null);
    prisma.twoFactorAuth.updateMany.mockResolvedValue({ count: 1 });
  });

  it.each(['setup', 'enable', 'disable'])(
    'bloqueia %s para ADMIN atual mesmo com Bearer antigo de estudante',
    async (operation) => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        roles: [{ role: { name: RoleName.ADMIN } }],
      });
      const result =
        operation === 'setup'
          ? controller.setupTwoFactor(student)
          : operation === 'enable'
            ? controller.enableTwoFactor(student, { code: '123456' })
            : controller.disableTwoFactor(student, { password: 'password' });
      await expect(result).rejects.toMatchObject({
        response: { code: 'ADMIN_ENROLLMENT_REQUIRED' },
      });
      expect(prisma.twoFactorAuth.upsert).not.toHaveBeenCalled();
      expect(prisma.twoFactorAuth.update).not.toHaveBeenCalled();
      expect(prisma.twoFactorAuth.updateMany).not.toHaveBeenCalled();
    },
  );

  it('preserva setup para estudante', async () => {
    await expect(controller.setupTwoFactor(student)).resolves.toMatchObject({
      secret: 'SEGREDOFICTICIO',
      issuer: 'UniMove',
    });
  });

  it('preserva ativação e desativação para estudante', async () => {
    prisma.twoFactorAuth.findUnique.mockResolvedValue({
      secret: encryptTwoFactorSecret('SEGREDOFICTICIO'),
      enabled: false,
    });
    await expect(controller.enableTwoFactor(student, { code: '123456' })).resolves.toEqual({
      enabled: true,
    });
    await expect(controller.disableTwoFactor(student, { password: 'password' })).resolves.toEqual({
      enabled: false,
    });
  });
});
