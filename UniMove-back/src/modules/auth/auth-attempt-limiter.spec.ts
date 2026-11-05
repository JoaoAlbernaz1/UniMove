import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../database/prisma.service';
import { AuthAttemptLimiter } from './auth-attempt-limiter';

// Only storage is substituted here; PostgreSQL locking is exercised by the
// integration test using independent clients and concurrent requests.
function sharedStorage() {
  const rows: any[] = [];
  const auditLog = {
    findFirst: jest.fn(({ where }: any) =>
      Promise.resolve(
        rows.find(
          (row) => row.entityType === where.entityType && row.entityId === where.entityId,
        ) ?? null,
      ),
    ),
    create: jest.fn(({ data }: any) => {
      const row = { id: String(rows.length + 1), ...data };
      rows.push(row);
      return Promise.resolve(row);
    }),
    update: jest.fn(({ where, data }: any) => {
      const row = rows.find((item) => item.id === where.id);
      Object.assign(row, data);
      return Promise.resolve(row);
    }),
  };
  const tx = { auditLog, $executeRaw: jest.fn().mockResolvedValue(1) };
  const prisma = {
    $transaction: (run: (client: typeof tx) => unknown) => run(tx),
  } as unknown as PrismaService;
  return { prisma, rows };
}

describe('AuthAttemptLimiter', () => {
  const config = new ConfigService({ auth: { accessSecret: 'synthetic-unit-test-server-secret' } });
  let storage: ReturnType<typeof sharedStorage>;
  let limiter: AuthAttemptLimiter;
  let second: AuthAttemptLimiter;

  beforeEach(() => {
    storage = sharedStorage();
    limiter = new AuthAttemptLimiter(storage.prisma, config);
    second = new AuthAttemptLimiter(storage.prisma, config);
  });

  it('shares failures and a full 15-minute block from the eighth failure across instances', async () => {
    for (let i = 0; i < 7; i += 1) await limiter.recordFailure('login:synthetic', 1_000_000);
    await expect(second.assertAllowed('login:synthetic', 1_100_000)).resolves.toBeUndefined();
    await second.recordFailure('login:synthetic', 1_100_000);
    await expect(limiter.assertAllowed('login:synthetic', 1_999_999)).rejects.toBeInstanceOf(
      HttpException,
    );
    await second.recordFailure('login:synthetic', 1_999_999);
    await expect(second.assertAllowed('login:other', 1_100_000)).resolves.toBeUndefined();
    await expect(second.assertAllowed('login:synthetic', 2_000_000)).resolves.toBeUndefined();
  });

  it('resets shared failures after successful authentication', async () => {
    for (let i = 0; i < 7; i += 1) await limiter.recordFailure('login:synthetic', 1_000_000);
    await second.reset('login:synthetic');
    await limiter.recordFailure('login:synthetic', 1_000_001);
    await expect(second.assertAllowed('login:synthetic', 1_000_001)).resolves.toBeUndefined();
  });

  it('starts a fresh failure counter after an expired block', async () => {
    for (let i = 0; i < 8; i += 1) await limiter.recordFailure('login:synthetic', 1_000_000);
    await second.recordFailure('login:synthetic', 1_900_000);
    await expect(limiter.assertAllowed('login:synthetic', 1_900_000)).resolves.toBeUndefined();
  });

  it('keeps consumed codes unavailable for 120 seconds and isolates users', async () => {
    await expect(limiter.claimCode('user-1', '123456', 1_000_000)).resolves.toBe(true);
    await expect(second.claimCode('user-1', '123456', 1_061_000)).resolves.toBe(false);
    await expect(second.claimCode('user-1', '123456', 1_119_999)).resolves.toBe(false);
    await expect(second.claimCode('user-2', '123456', 1_001_000)).resolves.toBe(true);
    await expect(second.claimCode('user-1', '123456', 1_120_000)).resolves.toBe(true);
  });

  it('never persists account identifiers, raw keys, OTPs, or the server secret', async () => {
    await limiter.recordFailure('login:synthetic-person@example.test', 1_000_000);
    await limiter.claimCode('synthetic-user-id', '123456', 1_000_000);
    const persisted = JSON.stringify(storage.rows);
    for (const raw of [
      'synthetic-person@example.test',
      'synthetic-user-id',
      '123456',
      'synthetic-unit-test-server-secret',
    ]) {
      expect(persisted).not.toContain(raw);
    }
    expect(storage.rows).toHaveLength(2);
    expect(storage.rows.every((row) => /^[a-f0-9]{64}$/.test(row.entityId))).toBe(true);
  });
});
