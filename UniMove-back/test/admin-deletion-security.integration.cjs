// PostgreSQL real; fixtures próprias, sem TRUNCATE ou limpeza global.
// Execução após o build: node test/admin-deletion-security.integration.cjs
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const argon2 = require('argon2');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('../dist/src/generated/prisma/client.js');
const { AccountDeletionService } = require('../dist/src/modules/users/account-deletion.service.js');
const { AdminUsersService } = require('../dist/src/modules/admin/admin-users.service.js');

let target;
try {
  target = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
} catch {
  console.error('Recusado: endereço do banco inválido.');
  process.exit(2);
}
if (
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  !target.pathname.endsWith('_test') ||
  process.env.NODE_ENV === 'production'
) {
  console.error('Recusado: use o banco local isolado da integração administrativa.');
  process.exit(2);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const password = 'DeletionFixture123!';
const namespace = randomUUID();
const userIds = [];
const auditIds = [];
let passwordHash;
let adminRole;
let ownedRoleId;
let passed = 0;
let failed = 0;

function gate() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

// Instrumentação do teste observa/pausa operações reais, sem substituir consultas.
function clientWithHooks({ beforeUserUpdate, afterAdminLock, beforeAuditCreate } = {}) {
  return new Proxy(prisma, {
    get(client, property) {
      if (property !== '$transaction') {
        const value = client[property];
        return typeof value === 'function' ? value.bind(client) : value;
      }
      return (callback, options) =>
        client.$transaction(async (tx) => {
          const proxy = new Proxy(tx, {
            get(transaction, key) {
              if (key === '$executeRaw')
                return async (...args) => {
                  const result = await transaction.$executeRaw(...args);
                  if (afterAdminLock) await afterAdminLock();
                  return result;
                };
              if (key === 'user')
                return new Proxy(transaction.user, {
                  get(delegate, method) {
                    if (method === 'update')
                      return async (args) => {
                        if (beforeUserUpdate) await beforeUserUpdate(args);
                        return delegate.update(args);
                      };
                    const value = delegate[method];
                    return typeof value === 'function' ? value.bind(delegate) : value;
                  },
                });
              if (key === 'auditLog')
                return new Proxy(transaction.auditLog, {
                  get(delegate, method) {
                    if (method === 'create')
                      return async (args) => {
                        if (beforeAuditCreate) await beforeAuditCreate();
                        const row = await delegate.create(args);
                        auditIds.push(row.id);
                        return row;
                      };
                    const value = delegate[method];
                    return typeof value === 'function' ? value.bind(delegate) : value;
                  },
                });
              const value = transaction[key];
              return typeof value === 'function' ? value.bind(transaction) : value;
            },
          });
          return callback(proxy);
        }, options);
    },
  });
}

async function createUser({ admin = false } = {}) {
  const id = randomUUID();
  userIds.push(id);
  return prisma.user.create({
    data: {
      id,
      fullName: 'Pessoa fictícia de exclusão',
      cpf: `fixture-${id}`,
      institutionalEmail: `deletion-${namespace}-${id}@example.invalid`,
      phone: '+5561999990000',
      passwordHash,
      ...(admin ? { roles: { create: { roleId: adminRole.id } } } : {}),
      twoFactor: {
        create: {
          secret: 'synthetic-encrypted-secret',
          enabled: true,
          recoveryCodes: ['synthetic-recovery-hash'],
        },
      },
      pushDevices: {
        create: { token: `ExponentPushToken[${id}]`, platform: 'android' },
      },
      refreshSessions: {
        create: {
          tokenHash: 'synthetic-refresh-hash',
          familyId: randomUUID(),
          expiresAt: new Date(Date.now() + 3600000),
        },
      },
    },
  });
}

function validAdmins() {
  return prisma.user.count({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      roles: { some: { role: { name: 'ADMIN' } } },
      twoFactor: { is: { enabled: true } },
    },
  });
}

async function assertCredentials(userId, removed) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  assert.equal(user.phone, removed ? null : '+5561999990000');
  assert.equal(user.status, removed ? 'DEACTIVATED' : 'ACTIVE');
  assert.equal(await prisma.twoFactorAuth.count({ where: { userId } }), removed ? 0 : 1);
  assert.equal(await prisma.pushDevice.count({ where: { userId } }), removed ? 0 : 1);
  assert.equal(await prisma.refreshSession.count({ where: { userId } }), removed ? 0 : 1);
}

async function waitForAdminLockWaiter() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const [row] = await prisma.$queryRaw`
      SELECT count(*)::int AS waiting FROM pg_locks
      WHERE locktype = 'advisory' AND objid = 717001 AND NOT granted
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
    if (row.waiting > 0) return;
    await delay(20);
  }
  throw new Error('A operação concorrente não chegou ao lock administrativo.');
}

async function cleanup() {
  const where = { userId: { in: userIds } };
  await prisma.auditLog.deleteMany({ where: { id: { in: auditIds } } });
  await prisma.academicVerification.deleteMany({ where });
  await prisma.twoFactorAuth.deleteMany({ where });
  await prisma.pushDevice.deleteMany({ where });
  await prisma.refreshSession.deleteMany({ where });
  await prisma.userRole.deleteMany({ where });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function test(name, run) {
  try {
    await run();
    passed += 1;
    console.log(`ok ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error.message}`);
  } finally {
    await cleanup();
  }
}

async function concurrentRestriction({ deletionFirst }) {
  assert.equal(await validAdmins(), 0, 'Este cenário requer ausência de admins de outros testes.');
  const deletingAdmin = await createUser({ admin: true });
  const otherAdmin = await createUser({ admin: true });
  const ready = gate();
  const proceed = gate();
  const actor = { id: deletingAdmin.id, roles: ['ADMIN'] };
  const restriction = { status: 'SUSPENDED', reason: 'Cenário fictício concorrente' };
  let deletion;
  let suspension;
  let barrierError;

  // Asserções vêm após liberar a barreira: até uma falha não deixa transação presa.
  try {
    if (deletionFirst) {
      let held = false;
      const client = clientWithHooks({
        afterAdminLock: async () => {
          if (held) return;
          held = true;
          ready.release();
          await proceed.promise;
        },
      });
      deletion = new AccountDeletionService(client).deleteAccount(deletingAdmin.id, password).then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error }),
      );
      await Promise.race([
        ready.promise,
        delay(10000, undefined, { ref: false }).then(() => {
          throw new Error('A exclusão não alcançou a barreira concorrente.');
        }),
      ]);
      suspension = new AdminUsersService(clientWithHooks(), {})
        .changeStatus(actor, otherAdmin.id, restriction)
        .then(
          () => ({ ok: true }),
          (error) => ({ ok: false, error }),
        );
    } else {
      const client = clientWithHooks({
        beforeUserUpdate: async (args) => {
          if (args.data.status !== 'SUSPENDED') return;
          ready.release();
          await proceed.promise;
        },
      });
      suspension = new AdminUsersService(client, {})
        .changeStatus(actor, otherAdmin.id, restriction)
        .then(
          () => ({ ok: true }),
          (error) => ({ ok: false, error }),
        );
      await Promise.race([
        ready.promise,
        delay(10000, undefined, { ref: false }).then(() => {
          throw new Error('A suspensão não alcançou a barreira concorrente.');
        }),
      ]);
      deletion = new AccountDeletionService(clientWithHooks())
        .deleteAccount(deletingAdmin.id, password)
        .then(
          () => ({ ok: true }),
          (error) => ({ ok: false, error }),
        );
    }
    await waitForAdminLockWaiter();
  } catch (error) {
    barrierError = error;
  } finally {
    proceed.release();
  }
  const outcomes = await Promise.all([deletion, suspension].filter(Boolean));
  if (barrierError) throw barrierError;
  assert.equal(await validAdmins(), 1, 'Exclusão e suspensão não podem zerar admins válidos.');
  assert.equal(outcomes.filter((result) => result.ok).length, 1);
  const loser = outcomes.find((result) => !result.ok);
  assert.ok(
    [403, 409].includes(loser.error.getStatus?.()),
    'A disputa deve retornar erro de domínio.',
  );
  if (loser.error.getStatus() === 409)
    assert.ok(['LAST_ADMIN', 'ACCOUNT_CONCURRENT_UPDATE'].includes(loser.error.getResponse().code));
}

async function main() {
  passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const candidateRoleId = randomUUID();
  adminRole = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    create: { id: candidateRoleId, name: 'ADMIN' },
    update: {},
  });
  if (adminRole.id === candidateRoleId) ownedRoleId = candidateRoleId;
  await test('exclusão remove credenciais e preserva decisões sobre terceiros', async () => {
    const user = await createUser();
    const thirdParty = await createUser();
    const decisionId = randomUUID();
    const ownLogId = randomUUID();
    auditIds.push(decisionId, ownLogId);
    await prisma.auditLog.createMany({
      data: [
        {
          id: decisionId,
          actorUserId: user.id,
          action: 'ACADEMIC_VERIFICATION_APPROVED',
          entityType: 'User',
          entityId: thirdParty.id,
          metadata: { status: 'APPROVED', reviewNote: 'Decisão fictícia preservada' },
          ip: '192.0.2.1',
        },
        {
          id: ownLogId,
          actorUserId: user.id,
          action: 'USER_PROFILE_UPDATED',
          entityType: 'User',
          entityId: user.id,
          metadata: { phone: '+5561999990000' },
          ip: '192.0.2.1',
        },
      ],
    });
    await prisma.academicVerification.create({
      data: {
        userId: thirdParty.id,
        reportGuid: randomUUID(),
        status: 'APPROVED',
        reviewedById: user.id,
      },
    });
    await new AccountDeletionService(clientWithHooks()).deleteAccount(user.id, password);
    await assertCredentials(user.id, true);
    const decision = await prisma.auditLog.findUniqueOrThrow({ where: { id: decisionId } });
    assert.equal(decision.actorUserId, user.id);
    assert.equal(decision.entityId, thirdParty.id);
    assert.deepEqual(decision.metadata, {
      status: 'APPROVED',
      reviewNote: 'Decisão fictícia preservada',
    });
    assert.equal(decision.ip, null, 'IP do autor é dado pessoal, não a decisão.');
    const verification = await prisma.academicVerification.findUniqueOrThrow({
      where: { userId: thirdParty.id },
    });
    assert.equal(verification.reviewedById, user.id);
    const ownLog = await prisma.auditLog.findUniqueOrThrow({ where: { id: ownLogId } });
    assert.equal(ownLog.actorUserId, null);
    assert.equal(ownLog.entityId, null);
    assert.equal(ownLog.metadata, null);
    assert.equal(ownLog.ip, null);
    await assertCredentials(thirdParty.id, false);
  });
  await test('falha final reverte telefone, fatores, push e sessões no PostgreSQL', async () => {
    const user = await createUser();
    const client = clientWithHooks({
      beforeAuditCreate: () => {
        throw new Error('Synthetic final write failure');
      },
    });
    await assert.rejects(new AccountDeletionService(client).deleteAccount(user.id, password), {
      message: 'Synthetic final write failure',
    });
    await assertCredentials(user.id, false);
  });
  await test('suspensão vence o lock: exclusão preserva o último admin', () =>
    concurrentRestriction({ deletionFirst: false }));
  await test('exclusão vence o lock: suspensão perde acesso e preserva outro admin', () =>
    concurrentRestriction({ deletionFirst: true }));
  console.log(`${passed} passaram, ${failed} falharam`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    if (ownedRoleId)
      await prisma.role.deleteMany({ where: { id: ownedRoleId, users: { none: {} } } });
    await prisma.$disconnect();
  });
