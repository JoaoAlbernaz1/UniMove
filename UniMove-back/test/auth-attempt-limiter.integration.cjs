// Focused PostgreSQL test. Only this run's fingerprinted fixtures are removed.
// Run after npm run build, with DATABASE_URL pointing to the isolated local DB.
const assert = require('node:assert/strict');
const { randomUUID, createHmac } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('../dist/src/generated/prisma/client.js');
const { AuthAttemptLimiter } = require('../dist/src/modules/auth/auth-attempt-limiter.js');

const target = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
if (
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  !target.pathname.endsWith('_test') ||
  process.env.NODE_ENV === 'production'
) {
  console.error('Refused: this test requires the dedicated local integration database.');
  process.exit(2);
}

const createClient = () =>
  new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const firstDb = createClient();
const secondDb = createClient();
const runId = randomUUID();
const secret = `synthetic-limiter-test-${randomUUID()}`;
const config = new ConfigService({ auth: { accessSecret: secret } });
const first = new AuthAttemptLimiter(firstDb, config);
const second = new AuthAttemptLimiter(secondDb, config);
const fixtureIds = new Set();

function fixture(domain, ...parts) {
  // Used only to scope cleanup, never for test expectations.
  const digest = createHmac('sha256', secret)
    .update(JSON.stringify([domain, ...parts]))
    .digest('hex');
  fixtureIds.add(digest);
}

async function main() {
  const login = `login:${runId}@example.test`;
  fixture('attempt', login);
  for (let i = 0; i < 7; i += 1) await first.recordFailure(login, 1_000_000);
  await second.assertAllowed(login, 1_100_000);
  await second.recordFailure(login, 1_100_000);
  await assert.rejects(async () => first.assertAllowed(login, 1_999_999), { status: 429 });

  // Destroy and recreate the original client, simulating process recreation.
  await firstDb.$disconnect();
  const recreatedDb = createClient();
  try {
    const recreated = new AuthAttemptLimiter(recreatedDb, config);
    await assert.rejects(recreated.assertAllowed(login, 1_999_999), { status: 429 });
    await second.recordFailure(login, 1_999_999);
    await recreated.assertAllowed(login, 2_000_000);
    await recreated.reset(login);
    await recreated.recordFailure(login, 2_000_001);
    await second.assertAllowed(login, 2_000_001);

    const user = `synthetic-user:${runId}`;
    fixture('code', user, '123456');
    fixture('code', `${user}:other`, '123456');
    const claims = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 ? second : recreated).claimCode(user, '123456', 3_000_000),
      ),
    );
    assert.equal(claims.filter(Boolean).length, 1, 'exactly one concurrent claim must win');
    assert.equal(await second.claimCode(user, '123456', 3_061_000), false);
    assert.equal(await second.claimCode(user, '123456', 3_119_999), false);
    assert.equal(await recreated.claimCode(`${user}:other`, '123456', 3_001_000), true);
    assert.equal(await recreated.claimCode(user, '123456', 3_120_000), true);

    const parallelLogin = `login:parallel:${runId}`;
    fixture('attempt', parallelLogin);
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        (index % 2 ? second : recreated).recordFailure(parallelLogin, 4_000_000),
      ),
    );
    await assert.rejects(recreated.assertAllowed(parallelLogin, 4_000_001), { status: 429 });
    await second.reset(parallelLogin);
    await recreated.assertAllowed(parallelLogin, 4_000_001);

    const rows = await secondDb.auditLog.findMany({
      where: {
        entityId: { in: [...fixtureIds] },
        entityType: { in: ['AuthAttemptLimit', 'AuthCodeClaim'] },
      },
    });
    assert.equal(rows.length, 4);
    const serialized = JSON.stringify(rows);
    for (const raw of [login, user, '123456', secret, runId])
      assert.equal(serialized.includes(raw), false);
    assert.ok(rows.every((row) => row.actorUserId === null));
    console.log(
      'PASS persistent failures, process recreation, shared reset, concurrent failures, one-winner TOTP, 120s expiry, privacy',
    );
  } finally {
    await recreatedDb.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await secondDb.auditLog.deleteMany({
        where: {
          entityId: { in: [...fixtureIds] },
          entityType: { in: ['AuthAttemptLimit', 'AuthCodeClaim'] },
        },
      });
    } finally {
      await Promise.all([firstDb.$disconnect(), secondDb.$disconnect()]);
    }
  });
