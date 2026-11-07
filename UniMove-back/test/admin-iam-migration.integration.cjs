// Teste de migração IAM em PostgreSQL descartável: semeia um ADMIN na versão
// anterior ao IAM e confere backfill, exclusões, sessão legada e privacidade.
// NÃO execute contra banco de produção. Chamadas: node <arquivo> before|after.
const assert = require('node:assert/strict');
const { Client } = require('pg');

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (
  !['127.0.0.1', 'localhost'].includes(url.hostname) ||
  !url.pathname.endsWith('_test') ||
  process.env.NODE_ENV === 'production'
) {
  throw new Error('Recusado: somente PostgreSQL local *_test, fora de produção.');
}
const mode = process.argv[2];
if (!['before', 'after'].includes(mode)) throw new Error('Use before ou after.');

const ids = {
  active: '00000000-0000-4000-8000-000000000011',
  deleted: '00000000-0000-4000-8000-000000000012',
  student: '00000000-0000-4000-8000-000000000013',
  session: '00000000-0000-4000-8000-000000000014',
};
const required = [
  'MANAGE_ADMINS',
  'MANAGE_USERS',
  'REVIEW_VERIFICATIONS',
  'MODERATE_INCIDENTS',
  'VIEW_REPORTS',
  'VIEW_AUDIT',
];

async function run() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    if (mode === 'before') {
      const exists = await db.query("SELECT to_regclass('public.admin_access') AS relation");
      assert.equal(exists.rows[0].relation, null, 'IAM não deve existir antes do backfill');

      const roleIds = {};
      for (const name of ['ADMIN', 'PASSENGER']) {
        const row = await db.query(
          'INSERT INTO roles (id, name) VALUES (gen_random_uuid(), $1::"RoleName") ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id',
          [name],
        );
        roleIds[name] = row.rows[0].id;
      }

      const people = [
        [ids.active, 'Gestor Legado Ativo', '00000000011', 'active@unimove.invalid', null, roleIds.ADMIN],
        [ids.deleted, 'Gestor Legado Excluido', '00000000012', 'deleted@unimove.invalid', new Date(), roleIds.ADMIN],
        [ids.student, 'Estudante Fixture', '00000000013', 'student@unimove.invalid', null, roleIds.PASSENGER],
      ];
      for (const [id, name, cpf, email, deleted, roleId] of people) {
        await db.query(
          'INSERT INTO users (id, full_name, cpf, institutional_email, password_hash, status, updated_at, deleted_at) VALUES ($1, $2, $3, $4, $5, $6::"UserStatus", NOW(), $7)',
          [id, name, cpf, email, 'fixture-unusable-hash', 'ACTIVE', deleted],
        );
        await db.query(
          'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
          [id, roleId],
        );
      }
      // Sessão criada antes da migração: deve receber escopo APP e não ADMIN.
      await db.query(
        'INSERT INTO refresh_sessions (id, user_id, token_hash, family_id, expires_at) VALUES ($1, $2, $3, gen_random_uuid(), NOW() + interval \'1 hour\')',
        [ids.session, ids.active, 'fixture-unusable-token-hash'],
      );

      // Simula grants padrão de Data API do Supabase sobre novas tabelas.
      for (const role of ['anon', 'authenticated']) {
        const found = await db.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
        if (!found.rowCount) await db.query('CREATE ROLE "' + role + '"');
      }
      await db.query(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated',
      );
      console.log('Fixtures anteriores ao IAM criadas exclusivamente em *_test.');
      return;
    }

    const applied = await db.query(
      "SELECT COUNT(*)::int AS total FROM _prisma_migrations WHERE migration_name = '202611070001_admin_iam' AND finished_at IS NOT NULL AND rolled_back_at IS NULL",
    );
    assert.equal(applied.rows[0].total, 1, 'a migration deve ter sido aplicada');

    const entries = await db.query('SELECT user_id, permissions::text[] AS permissions FROM admin_access ORDER BY user_id');
    assert.equal(entries.rowCount, 1, 'somente o ADMIN ativo recebe backfill');
    assert.equal(entries.rows[0].user_id, ids.active);
    assert.deepEqual([...entries.rows[0].permissions].sort(), [...required].sort());

    const legacy = await db.query('SELECT scope FROM refresh_sessions WHERE id = $1', [ids.session]);
    assert.equal(legacy.rows[0]?.scope, 'APP', 'sessões antigas devem ter escopo APP');

    for (const table of ['admin_access', 'admin_invites', 'admin_password_resets', 'admin_mfa_recoveries']) {
      const row = await db.query(
        'SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = $1 AND c.relname = $2',
        ['public', table],
      );
      assert.equal(row.rows[0]?.relrowsecurity, true, table + ' deve ter RLS habilitado');
      for (const role of ['anon', 'authenticated']) {
        const grants = await db.query(
          'SELECT has_table_privilege($1, $2, $3) AS allowed',
          [role, 'public.' + table, 'SELECT'],
        );
        assert.equal(grants.rows[0].allowed, false, role + ' não deve ler ' + table);
      }
    }

    const indexes = await db.query(
      "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname IN ('admin_invites_email_pending_key', 'admin_mfa_recoveries_open_key')",
    );
    assert.equal(indexes.rowCount, 2, 'índices parciais anti-corrida devem existir');
    console.log('Backfill preservado, sessão legada APP, índices e acesso Data API protegidos.');
  } finally {
    await db.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
