// Testes de ponta a ponta da gestão de identidade administrativa (convite,
// permissões, redefinição de senha, recuperação de segundo fator e sessões)
// contra um PostgreSQL real. É aqui que as condições de corrida são provadas:
// dublê de Prisma não serializa transação nem respeita índice parcial.
//
// APAGA TODOS OS DADOS do banco apontado por DATABASE_URL. Por isso recusa rodar
// se o host não for local ou se o nome do banco não terminar em _test.
//
// Execução: npm run test:iam-integration
require('dotenv/config');
const assert = require('node:assert/strict');
const { randomInt } = require('node:crypto');

const target = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
if (
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  !target.pathname.endsWith('_test') ||
  process.env.NODE_ENV === 'production'
) {
  console.error('Recusado: este teste só roda em banco local cujo nome termina em _test.');
  process.exit(2);
}

const PANEL = 'http://panel.test';
process.env.ADMIN_PANEL_ORIGINS = PANEL;
process.env.ADMIN_PANEL_URL = PANEL;
process.env.TWO_FACTOR_ENCRYPTION_KEY = 'integration-only-two-factor-key-0123456789';
process.env.JWT_ACCESS_SECRET ??= 'integration-only-access-secret-0123456789';
process.env.JWT_REFRESH_SECRET ??= 'integration-only-refresh-secret-012345678';
process.env.ALLOWED_INSTITUTIONAL_EMAIL_DOMAINS ??= 'ucb.edu.br';
process.env.MAIL_PROVIDER = 'none';
process.env.SMTP_HOST = '';
process.env.TWILIO_ACCOUNT_SID = '';

const argon2 = require('argon2');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const { generate, generateSecret } = require('otplib');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { AppModule } = require('../dist/src/app.module.js');
const { HttpExceptionFilter } = require('../dist/src/common/filters/http-exception.filter.js');
const { PrismaService } = require('../dist/src/database/prisma.service.js');
const { MailService } = require('../dist/src/modules/mail/mail.service.js');
const { encryptTwoFactorSecret } = require('../dist/src/modules/auth/two-factor-crypto.js');

const prisma = new PrismaService();
const API = '/api/v1';
const PASSWORD = 'SenhaForte123!';
const NEW_PASSWORD = 'OutraSenhaForte456!';
const ALL_PERMISSIONS = [
  'MANAGE_ADMINS',
  'MANAGE_USERS',
  'REVIEW_VERIFICATIONS',
  'MODERATE_INCIDENTS',
  'VIEW_REPORTS',
  'VIEW_AUDIT',
];

let http;
let passwordHash;
let serial = 0;
const results = { passed: 0, failed: [] };
/** Caixa de saída: o MailService é substituído para o token chegar ao teste. */
const outbox = [];

async function it(name, run) {
  try {
    await run();
    results.passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    results.failed.push(name);
    console.log(`  FAIL ${name}\n       ${error.message.split('\n').slice(0, 6).join('\n       ')}`);
  }
}

function randomCpf() {
  let digits = String(randomInt(100000000, 999999999));
  for (const length of [9, 10]) {
    const sum = [...digits].reduce((acc, d, i) => acc + Number(d) * (length + 1 - i), 0);
    const rest = (sum * 10) % 11;
    digits += rest === 10 ? '0' : String(rest);
  }
  return digits;
}

let ipCounter = 0;
const nextIp = () => {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
};

/** Token em claro só existe no e-mail: o banco guarda apenas o hash. */
function tokenFor(email, { last = true } = {}) {
  const messages = outbox.filter((message) => message.to === email);
  const message = last ? messages.at(-1) : messages[0];
  assert.ok(message, `nenhum e-mail para ${email}`);
  const match = message.text.match(/token=([\w-]+)/);
  assert.ok(match, `nenhum token no e-mail "${message.subject}"`);
  return match[1];
}

async function createUser({ roles = ['PASSENGER'], status = 'ACTIVE', twoFactor, ...data } = {}) {
  serial += 1;
  const roleRows = await prisma.role.findMany({ where: { name: { in: roles } } });
  const email = `pessoa${serial}.${randomInt(1000, 9999)}@ucb.edu.br`;
  const secret = twoFactor ? generateSecret() : undefined;
  const user = await prisma.user.create({
    data: {
      fullName: `Pessoa ${serial}`,
      cpf: randomCpf(),
      institutionalEmail: email,
      passwordHash,
      status,
      roles: { create: roleRows.map((role) => ({ roleId: role.id })) },
      ...(secret
        ? { twoFactor: { create: { secret: encryptTwoFactorSecret(secret), enabled: true } } }
        : {}),
      ...data,
    },
  });
  return { ...user, email, secret };
}

async function createAdmin({ permissions = ALL_PERMISSIONS, ...data } = {}) {
  const admin = await createUser({ roles: ['ADMIN'], twoFactor: true, ...data });
  if (permissions)
    await prisma.adminAccess.create({ data: { userId: admin.id, permissions } });
  return admin;
}

/** Navegador mínimo: guarda cookies, reenvia e manda Origin e CSRF como o painel. */
class Panel {
  jar = new Map();
  ip = nextIp();

  apply(req, { csrf = true, origin = PANEL } = {}) {
    req.set('X-Forwarded-For', this.ip);
    if (origin) req.set('Origin', origin);
    const cookie = [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ');
    if (cookie) req.set('Cookie', cookie);
    if (csrf && this.jar.has('uc_admin_csrf'))
      req.set('x-csrf-token', this.jar.get('uc_admin_csrf'));
    return req;
  }

  store(response) {
    for (const line of response.headers['set-cookie'] ?? []) {
      const [pair] = line.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (!value || /Expires=Thu, 01 Jan 1970/i.test(line)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return response;
  }

  async send(method, path, { body, ...options } = {}) {
    const req = this.apply(http[method](`${API}${path}`), options);
    return this.store(await (body === undefined ? req : req.send(body)));
  }

  get = (path, options) => this.send('get', path, options);
  post = (path, options) => this.send('post', path, options);
  patch = (path, options) => this.send('patch', path, options);
  delete = (path, options) => this.send('delete', path, options);
}

async function signIn(admin, password = PASSWORD) {
  const panel = new Panel();
  const login = await panel.post('/admin/auth/login', { body: { email: admin.email, password } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.step, 'TWO_FACTOR');
  const verified = await panel.post('/admin/auth/two-factor', {
    body: { code: await freshCode(admin.secret) },
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  return panel;
}

/** Credenciais de step-up, com código novo para não bater no claimCode. */
async function reauth(admin) {
  return { password: PASSWORD, twoFactorCode: await freshCode(admin.secret) };
}

/**
 * Um TOTP só vale uma vez por conta: claimCode guarda o par (conta, código) por
 * 120 s. Dá dois códigos usáveis por janela de 30 s — o atual e o anterior, que
 * o servidor ainda aceita por epochTolerance. O da janela seguinte fica de fora
 * de propósito: perto da virada do passo ele entra e sai da tolerância, e o
 * teste ficaria intermitente.
 *
 * Quando os dois acabam, só resta esperar a janela virar — é o mesmo que a
 * pessoa faz olhando o autenticador, e é por isso que a reautenticação devolve
 * ADMIN_REAUTH_CODE_ALREADY_USED em vez de "código inválido".
 */
const usedCodes = new Set();
async function freshCode(secret, attempt = 0) {
  const base = Date.now();
  for (const offset of [0, -30_000]) {
    const code = await generate({ secret, timestamp: base + offset });
    const key = `${secret}:${code}`;
    if (!usedCodes.has(key)) {
      usedCodes.add(key);
      return code;
    }
  }
  if (attempt >= 3) throw new Error('não foi possível gerar um código novo');
  // Espera a virada do passo de 30 s, com um segundo de folga.
  await new Promise((resolve) => setTimeout(resolve, 31_000 - (base % 30_000)));
  return freshCode(secret, attempt + 1);
}

async function main() {
  await prisma.$connect();
  await prisma.$executeRawUnsafe(
    'TRUNCATE users, audit_logs, admin_invites, admin_access, admin_password_resets, admin_mfa_recoveries RESTART IDENTITY CASCADE',
  );
  // Os papéis vêm do seed, mas test:admin-integration os apaga no cleanup dele.
  // Garantir aqui deixa esta suíte independente da ordem de execução.
  for (const name of ['PASSENGER', 'DRIVER', 'ADMIN'])
    await prisma.role.upsert({ where: { name }, create: { name }, update: {} });
  passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue({
      provider: () => 'none',
      send: (message) => {
        outbox.push(message);
        return Promise.resolve('SENT');
      },
    })
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.set('trust proxy', 1);
  await app.init();
  http = request(app.getHttpServer());

  console.log('\nConvite administrativo');

  await it('ciclo completo: convite, endereço, senha, segundo fator e acesso', async () => {
    const manager = await createAdmin();
    const panel = await signIn(manager);
    const email = `convidada${randomInt(1000, 9999)}@ucb.edu.br`;
    const created = await panel.post('/admin/invites', {
      body: { email, fullName: 'Pessoa Convidada', permissions: ['MANAGE_USERS', 'VIEW_AUDIT'] },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const token = tokenFor(email);
    const row = await prisma.adminInvite.findFirst({ where: { email } });
    assert.notEqual(row.tokenHash, token, 'o token em claro não pode estar no banco');

    const guest = new Panel();
    const preview = await guest.post('/admin/auth/invites/confirm-email', { body: { token } });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.deepEqual(preview.body.permissions, ['MANAGE_USERS', 'VIEW_AUDIT']);
    assert.equal(preview.body.accountExists, false);

    const password = await guest.post('/admin/auth/invites/password', {
      body: { token, cpf: randomCpf(), password: PASSWORD },
    });
    assert.equal(password.status, 200, JSON.stringify(password.body));
    const secret = password.body.twoFactor.secret;
    assert.ok(password.body.twoFactor.qrCode.startsWith('data:image/png;base64,'));

    // Antes de confirmar o código não existe acesso: nem papel, nem permissão.
    const pending = await prisma.user.findUnique({
      where: { institutionalEmail: email },
      select: { roles: true, adminAccess: true },
    });
    assert.deepEqual(pending.roles, []);
    assert.equal(pending.adminAccess, null);

    const activated = await guest.post('/admin/auth/invites/two-factor', {
      body: { token, code: await freshCode(secret) },
    });
    assert.equal(activated.status, 200, JSON.stringify(activated.body));
    assert.equal(activated.body.recoveryCodes.length, 8);

    const access = await prisma.adminAccess.findFirst({
      where: { user: { institutionalEmail: email } },
    });
    assert.deepEqual(access.permissions, ['MANAGE_USERS', 'VIEW_AUDIT']);
    assert.equal(access.grantedById, manager.id);

    // E o acesso funciona de verdade: login com senha e segundo fator novos.
    const session = await signIn({ email, secret });
    const me = await session.get('/admin/auth/session');
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.permissions, ['MANAGE_USERS', 'VIEW_AUDIT']);
    // Sem MANAGE_ADMINS a gestão de acessos continua fechada para ela.
    assert.equal((await session.get('/admin/admins')).status, 403);
  });

  await it('códigos de recuperação do convite ficam só como hash', async () => {
    const manager = await createAdmin();
    const panel = await signIn(manager);
    const email = `hash${randomInt(1000, 9999)}@ucb.edu.br`;
    await panel.post('/admin/invites', {
      body: { email, fullName: 'Pessoa Hash', permissions: ['VIEW_AUDIT'] },
    });
    const token = tokenFor(email);
    const guest = new Panel();
    await guest.post('/admin/auth/invites/confirm-email', { body: { token } });
    const password = await guest.post('/admin/auth/invites/password', {
      body: { token, cpf: randomCpf(), password: PASSWORD },
    });
    const activated = await guest.post('/admin/auth/invites/two-factor', {
      body: { token, code: await freshCode(password.body.twoFactor.secret) },
    });
    const factor = await prisma.twoFactorAuth.findFirst({
      where: { user: { institutionalEmail: email } },
    });
    for (const [index, code] of activated.body.recoveryCodes.entries())
      assert.ok(await argon2.verify(factor.recoveryCodes[index], code.replace('-', '')));
    assert.ok(!factor.recoveryCodes.some((hash) => activated.body.recoveryCodes.includes(hash)));
    assert.notEqual(factor.secret, password.body.twoFactor.secret, 'segredo gravado deve ser cifrado');
  });

  await it('dois convites simultâneos para o mesmo e-mail: só um vence', async () => {
    const manager = await createAdmin();
    const panel = await signIn(manager);
    const email = `corrida${randomInt(1000, 9999)}@ucb.edu.br`;
    const body = { email, fullName: 'Pessoa Corrida', permissions: ['VIEW_AUDIT'] };
    const [a, b] = await Promise.all([
      panel.post('/admin/invites', { body }),
      panel.post('/admin/invites', { body }),
    ]);
    const codes = [a.status, b.status].sort();
    assert.deepEqual(codes, [201, 409], `${a.status}/${b.status}`);
    assert.equal(await prisma.adminInvite.count({ where: { email, status: 'PENDING' } }), 1);
  });

  await it('duas ativações simultâneas do mesmo convite: só uma concede acesso', async () => {
    const manager = await createAdmin();
    const panel = await signIn(manager);
    const email = `dupla${randomInt(1000, 9999)}@ucb.edu.br`;
    await panel.post('/admin/invites', {
      body: { email, fullName: 'Pessoa Dupla', permissions: ['VIEW_AUDIT'] },
    });
    const token = tokenFor(email);
    const guest = new Panel();
    await guest.post('/admin/auth/invites/confirm-email', { body: { token } });
    const password = await guest.post('/admin/auth/invites/password', {
      body: { token, cpf: randomCpf(), password: PASSWORD },
    });
    const code = await freshCode(password.body.twoFactor.secret);
    const [a, b] = await Promise.all([
      new Panel().post('/admin/auth/invites/two-factor', { body: { token, code } }),
      new Panel().post('/admin/auth/invites/two-factor', { body: { token, code } }),
    ]);
    assert.equal([a, b].filter((r) => r.status === 200).length, 1, `${a.status}/${b.status}`);
    const roles = await prisma.userRole.count({ where: { user: { institutionalEmail: email } } });
    assert.equal(roles, 1);
  });

  await it('token do convite não serve depois de aceito nem depois de revogado', async () => {
    const manager = await createAdmin();
    const panel = await signIn(manager);
    const email = `reuso${randomInt(1000, 9999)}@ucb.edu.br`;
    await panel.post('/admin/invites', {
      body: { email, fullName: 'Pessoa Reuso', permissions: ['VIEW_AUDIT'] },
    });
    const token = tokenFor(email);
    const guest = new Panel();
    await guest.post('/admin/auth/invites/confirm-email', { body: { token } });
    const password = await guest.post('/admin/auth/invites/password', {
      body: { token, cpf: randomCpf(), password: PASSWORD },
    });
    await guest.post('/admin/auth/invites/two-factor', {
      body: { token, code: await freshCode(password.body.twoFactor.secret) },
    });
    const again = await guest.post('/admin/auth/invites/confirm-email', { body: { token } });
    assert.equal(again.status, 401);

    const other = `revogado${randomInt(1000, 9999)}@ucb.edu.br`;
    const created = await panel.post('/admin/invites', {
      body: { email: other, fullName: 'Pessoa Revogada', permissions: ['VIEW_AUDIT'] },
    });
    const revoked = await panel.post(`/admin/invites/${created.body.invite.id}/revoke`);
    assert.equal(revoked.status, 200);
    const blocked = await new Panel().post('/admin/auth/invites/confirm-email', {
      body: { token: tokenFor(other) },
    });
    assert.equal(blocked.status, 401);
  });

  await it('convite não troca a senha de conta de estudante já existente', async () => {
    const student = await createUser();
    const manager = await createAdmin();
    const panel = await signIn(manager);
    await panel.post('/admin/invites', {
      body: { email: student.email, fullName: 'Estudante Promovida', permissions: ['VIEW_AUDIT'] },
    });
    const token = tokenFor(student.email);
    const guest = new Panel();
    const preview = await guest.post('/admin/auth/invites/confirm-email', { body: { token } });
    assert.equal(preview.body.accountExists, true);
    const refused = await guest.post('/admin/auth/invites/password', {
      body: { token, password: NEW_PASSWORD },
    });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.code, 'CURRENT_PASSWORD_REQUIRED');
    const ok = await guest.post('/admin/auth/invites/password', {
      body: { token, currentPassword: PASSWORD },
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const after = await prisma.user.findUnique({ where: { id: student.id } });
    assert.equal(after.passwordHash, student.passwordHash, 'a senha do estudante não muda');
  });

  await it('e-mail fora do domínio institucional e rota sem origem são recusados', async () => {
    const manager = await createAdmin();
    const panel = await signIn(manager);
    const fora = await panel.post('/admin/invites', {
      body: { email: 'pessoa@gmail.com', fullName: 'Fora do domínio', permissions: [] },
    });
    assert.equal(fora.status, 400);
    assert.equal(fora.body.code, 'ADMIN_INVITE_DOMAIN_REJECTED');
    const semOrigem = await new Panel().post('/admin/auth/invites/confirm-email', {
      body: { token: 'x'.repeat(43) },
      origin: null,
    });
    assert.equal(semOrigem.status, 403);
    assert.equal(semOrigem.body.code, 'ADMIN_ORIGIN_REJECTED');
  });

  console.log('\nPermissões e revogação');

  await it('rota de gestão exige MANAGE_ADMINS, não apenas papel ADMIN', async () => {
    const limited = await createAdmin({ permissions: ['VIEW_REPORTS'] });
    const panel = await signIn(limited);
    const denied = await panel.get('/admin/admins');
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'ADMIN_PERMISSION_REQUIRED');
    // As rotas administrativas que já existiam continuam abertas a qualquer ADMIN.
    assert.equal((await panel.get('/admin/dashboard/summary')).status, 200);
  });

  await it('administrador sem linha de permissões não gerencia acessos', async () => {
    const legacy = await createAdmin({ permissions: null });
    const panel = await signIn(legacy);
    assert.equal((await panel.get('/admin/admins')).status, 403);
    assert.equal((await panel.get('/admin/auth/session')).body.permissions.length, 0);
  });

  await it('alterar permissões exige reautenticação e audita antes e depois', async () => {
    const manager = await createAdmin();
    const other = await createAdmin({ permissions: ['VIEW_REPORTS'] });
    const panel = await signIn(manager);
    const semReauth = await panel.patch(`/admin/admins/${other.id}/permissions`, {
      body: { permissions: ['VIEW_AUDIT'], reason: 'Sem reautenticar' },
    });
    assert.equal(semReauth.status, 400, JSON.stringify(semReauth.body));
    const comSenhaErrada = await panel.patch(`/admin/admins/${other.id}/permissions`, {
      body: {
        permissions: ['VIEW_AUDIT'],
        reason: 'Senha errada',
        password: 'errada',
        twoFactorCode: await freshCode(manager.secret),
      },
    });
    assert.equal(comSenhaErrada.status, 401);
    const ok = await panel.patch(`/admin/admins/${other.id}/permissions`, {
      body: {
        permissions: ['VIEW_AUDIT', 'MANAGE_USERS'],
        reason: 'Passa a cuidar de usuários',
        ...(await reauth(manager)),
      },
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(ok.body.permissions, ['MANAGE_USERS', 'VIEW_AUDIT']);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'ADMIN_PERMISSIONS_CHANGED', entityId: other.id },
    });
    assert.deepEqual(audit.metadata.previous, ['VIEW_REPORTS']);
    assert.deepEqual(audit.metadata.permissions, ['MANAGE_USERS', 'VIEW_AUDIT']);
  });

  await it('o último gestor de acessos não perde MANAGE_ADMINS', async () => {
    await prisma.adminAccess.deleteMany({});
    const only = await createAdmin();
    const panel = await signIn(only);
    const blocked = await panel.patch(`/admin/admins/${only.id}/permissions`, {
      body: {
        permissions: ['VIEW_AUDIT'],
        reason: 'Tentando ficar sem gestor',
        ...(await reauth(only)),
      },
    });
    assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
    assert.equal(blocked.body.code, 'LAST_ADMIN_MANAGER');
    const access = await prisma.adminAccess.findUnique({ where: { userId: only.id } });
    assert.ok(access.permissions.includes('MANAGE_ADMINS'));
  });

  await it('dois gestores revogando um ao outro ao mesmo tempo: sobra pelo menos um', async () => {
    await prisma.adminAccess.deleteMany({});
    const a = await createAdmin();
    const b = await createAdmin();
    const panelA = await signIn(a);
    const panelB = await signIn(b);
    const [ra, rb] = await Promise.all([
      panelA.post(`/admin/admins/${b.id}/revoke`, {
        body: { reason: 'Corrida A sobre B', ...(await reauth(a)) },
      }),
      panelB.post(`/admin/admins/${a.id}/revoke`, {
        body: { reason: 'Corrida B sobre A', ...(await reauth(b)) },
      }),
    ]);
    const survivors = await prisma.user.count({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        roles: { some: { role: { name: 'ADMIN' } } },
        twoFactor: { is: { enabled: true } },
        adminAccess: { is: { permissions: { has: 'MANAGE_ADMINS' } } },
      },
    });
    assert.ok(survivors >= 1, `nenhum gestor sobrou (${ra.status}/${rb.status})`);
  });

  await it('revogar acesso retira papel e permissões, e derruba a sessão do painel', async () => {
    const manager = await createAdmin();
    const victim = await createAdmin({ permissions: ['VIEW_REPORTS'] });
    const managerPanel = await signIn(manager);
    const victimPanel = await signIn(victim);
    assert.equal((await victimPanel.get('/admin/dashboard/summary')).status, 200);
    const revoked = await managerPanel.post(`/admin/admins/${victim.id}/revoke`, {
      body: { reason: 'Saiu da equipe', ...(await reauth(manager)) },
    });
    assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
    assert.equal(await prisma.adminAccess.count({ where: { userId: victim.id } }), 0);
    assert.equal(await prisma.userRole.count({ where: { userId: victim.id } }), 0);
    const after = await victimPanel.get('/admin/dashboard/summary');
    assert.ok([401, 403].includes(after.status), `esperava 401/403, veio ${after.status}`);
  });

  await it('ninguém encerra o próprio acesso administrativo', async () => {
    const manager = await createAdmin();
    const panel = await signIn(manager);
    const refused = await panel.post(`/admin/admins/${manager.id}/revoke`, {
      body: { reason: 'Saindo sozinho', ...(await reauth(manager)) },
    });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'CANNOT_REVOKE_OWN_ACCESS');
  });

  await it('conta sem papel ADMIN não ganha permissão por aqui', async () => {
    const manager = await createAdmin();
    const student = await createUser();
    const panel = await signIn(manager);
    const refused = await panel.patch(`/admin/admins/${student.id}/permissions`, {
      body: {
        permissions: ['MANAGE_ADMINS'],
        reason: 'Tentativa de escalonamento',
        ...(await reauth(manager)),
      },
    });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'NOT_AN_ADMIN');
    assert.equal(await prisma.adminAccess.count({ where: { userId: student.id } }), 0);
  });

  console.log('\nRedefinição de senha');

  await it('resposta não revela se a conta existe', async () => {
    const admin = await createAdmin();
    const real = await new Panel().post('/admin/auth/password-reset', {
      body: { email: admin.email },
    });
    const fake = await new Panel().post('/admin/auth/password-reset', {
      body: { email: `inexistente${randomInt(1000, 9999)}@ucb.edu.br` },
    });
    assert.equal(real.status, 202);
    assert.equal(fake.status, 202);
    assert.deepEqual(real.body, fake.body);
  });

  await it('troca a senha, derruba as sessões e mantém o segundo fator obrigatório', async () => {
    const admin = await createAdmin();
    const panel = await signIn(admin);
    assert.equal((await panel.get('/admin/dashboard/summary')).status, 200);
    await new Panel().post('/admin/auth/password-reset', { body: { email: admin.email } });
    const token = tokenFor(admin.email);
    const confirmed = await new Panel().post('/admin/auth/password-reset/confirm', {
      body: { token, password: NEW_PASSWORD },
    });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.twoFactorStillRequired, true);
    const after = await panel.get('/admin/dashboard/summary');
    assert.ok([401, 403].includes(after.status), `sessão deveria cair, veio ${after.status}`);
    // A senha nova funciona e o login continua exigindo o segundo fator.
    const login = await new Panel().post('/admin/auth/login', {
      body: { email: admin.email, password: NEW_PASSWORD },
    });
    assert.equal(login.body.step, 'TWO_FACTOR');
    const velha = await new Panel().post('/admin/auth/login', {
      body: { email: admin.email, password: PASSWORD },
    });
    assert.equal(velha.status, 401);
    const factor = await prisma.twoFactorAuth.findUnique({ where: { userId: admin.id } });
    assert.equal(factor.enabled, true);
  });

  await it('o link de senha serve uma única vez e o pedido novo invalida o antigo', async () => {
    const admin = await createAdmin();
    await new Panel().post('/admin/auth/password-reset', { body: { email: admin.email } });
    const first = tokenFor(admin.email);
    await new Panel().post('/admin/auth/password-reset', { body: { email: admin.email } });
    const second = tokenFor(admin.email);
    assert.notEqual(first, second);
    const antigo = await new Panel().post('/admin/auth/password-reset/confirm', {
      body: { token: first, password: NEW_PASSWORD },
    });
    assert.equal(antigo.status, 401);
    const novo = await new Panel().post('/admin/auth/password-reset/confirm', {
      body: { token: second, password: NEW_PASSWORD },
    });
    assert.equal(novo.status, 200);
    const reuso = await new Panel().post('/admin/auth/password-reset/confirm', {
      body: { token: second, password: 'TerceiraSenha789!' },
    });
    assert.equal(reuso.status, 401);
  });

  await it('conta de estudante não recebe link de redefinição administrativa', async () => {
    const student = await createUser();
    const response = await new Panel().post('/admin/auth/password-reset', {
      body: { email: student.email },
    });
    assert.equal(response.status, 202);
    assert.equal(await prisma.adminPasswordReset.count({ where: { userId: student.id } }), 0);
  });

  console.log('\nRecuperação do segundo fator');

  await it('só o e-mail não abre pedido: a senha é obrigatória', async () => {
    const admin = await createAdmin();
    const response = await new Panel().post('/admin/auth/mfa-recovery', {
      body: { email: admin.email, password: 'errada', reason: 'Perdi o autenticador do celular' },
    });
    assert.equal(response.status, 202);
    assert.equal(await prisma.adminMfaRecovery.count({ where: { userId: admin.id } }), 0);
  });

  await it('pedido aprovado por outro gestor troca o fator e derruba as sessões', async () => {
    await prisma.adminAccess.deleteMany({});
    const manager = await createAdmin();
    const admin = await createAdmin();
    const adminPanel = await signIn(admin);
    outbox.length = 0;

    const opened = await new Panel().post('/admin/auth/mfa-recovery', {
      body: {
        email: admin.email,
        password: PASSWORD,
        reason: 'Perdi o celular com o autenticador',
      },
    });
    assert.equal(opened.status, 202);
    const pending = await prisma.adminMfaRecovery.findFirst({ where: { userId: admin.id } });
    assert.equal(pending.status, 'PENDING');
    assert.equal(pending.tokenHash, null, 'token só nasce na aprovação');
    assert.ok(outbox.some((m) => m.to === manager.email), 'o gestor precisa ser avisado');

    const managerPanel = await signIn(manager);
    const own = await adminPanel.post(`/admin/mfa-recoveries/${pending.id}/review`, {
      body: { approve: true, ...(await reauth(admin)) },
    });
    assert.equal(own.status, 409, 'ninguém aprova o próprio pedido');
    assert.equal(own.body.code, 'CANNOT_REVIEW_OWN_RECOVERY');

    const approved = await managerPanel.post(`/admin/mfa-recoveries/${pending.id}/review`, {
      body: { approve: true, note: 'Identidade confirmada por telefone', ...(await reauth(manager)) },
    });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));

    const token = tokenFor(admin.email);
    const semSenha = await new Panel().post('/admin/auth/mfa-recovery/start', {
      body: { token, password: 'errada' },
    });
    assert.equal(semSenha.status, 401, 'o link sozinho não desativa o segundo fator');
    const started = await new Panel().post('/admin/auth/mfa-recovery/start', {
      body: { token, password: PASSWORD },
    });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const novo = started.body.twoFactor.secret;

    const caiu = await adminPanel.get('/admin/dashboard/summary');
    assert.ok([401, 403].includes(caiu.status), `sessão deveria cair, veio ${caiu.status}`);

    const finished = await new Panel().post('/admin/auth/mfa-recovery/confirm', {
      body: { token, code: await freshCode(novo) },
    });
    assert.equal(finished.status, 200, JSON.stringify(finished.body));
    assert.equal(finished.body.recoveryCodes.length, 8);
    assert.equal(
      (await prisma.adminMfaRecovery.findUnique({ where: { id: pending.id } })).status,
      'COMPLETED',
    );

    // O autenticador antigo deixou de valer; o novo entra.
    const velho = await new Panel().post('/admin/auth/login', {
      body: { email: admin.email, password: PASSWORD },
    });
    assert.equal(velho.body.step, 'TWO_FACTOR');
    const comVelho = await signIn({ email: admin.email, secret: admin.secret }).catch(
      (error) => error,
    );
    assert.ok(comVelho instanceof Error, 'o autenticador antigo não deveria mais entrar');
    const session = await signIn({ email: admin.email, secret: novo });
    assert.equal((await session.get('/admin/auth/session')).status, 200);
  });

  await it('recusar o pedido avisa quem pediu e não gera token', async () => {
    await prisma.adminAccess.deleteMany({});
    const manager = await createAdmin();
    const admin = await createAdmin();
    await new Panel().post('/admin/auth/mfa-recovery', {
      body: { email: admin.email, password: PASSWORD, reason: 'Pedido a ser recusado' },
    });
    const pending = await prisma.adminMfaRecovery.findFirst({
      where: { userId: admin.id, status: 'PENDING' },
    });
    const panel = await signIn(manager);
    const rejected = await panel.post(`/admin/mfa-recoveries/${pending.id}/review`, {
      body: { approve: false, note: 'Procure a equipe', ...(await reauth(manager)) },
    });
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
    const row = await prisma.adminMfaRecovery.findUnique({ where: { id: pending.id } });
    assert.equal(row.status, 'REJECTED');
    assert.equal(row.tokenHash, null);
    assert.ok(outbox.some((m) => m.to === admin.email && /recusada/i.test(m.subject)));
  });

  await it('um pedido em aberto por conta, mesmo com dois envios simultâneos', async () => {
    await prisma.adminAccess.deleteMany({});
    await createAdmin();
    const admin = await createAdmin();
    const body = {
      email: admin.email,
      password: PASSWORD,
      reason: 'Dois pedidos ao mesmo tempo',
    };
    await Promise.all([
      new Panel().post('/admin/auth/mfa-recovery', { body }),
      new Panel().post('/admin/auth/mfa-recovery', { body }),
    ]);
    assert.equal(
      await prisma.adminMfaRecovery.count({
        where: { userId: admin.id, status: { in: ['PENDING', 'APPROVED'] } },
      }),
      1,
    );
  });

  console.log('\nSessões administrativas');

  await it('lista as sessões do painel, marca a atual e ignora a do aplicativo', async () => {
    const admin = await createAdmin();
    const first = await signIn(admin);
    const second = await signIn(admin);
    // Sessão do aplicativo, criada pelo login comum: não é do painel gerenciar.
    const appLogin = await http
      .post(`${API}/auth/login`)
      .set('X-Forwarded-For', nextIp())
      .send({
        email: admin.email,
        password: PASSWORD,
        twoFactorCode: await freshCode(admin.secret),
      });
    assert.equal(appLogin.status, 200, JSON.stringify(appLogin.body));
    const list = await second.get('/admin/sessions');
    assert.equal(list.status, 200);
    assert.equal(list.body.items.length, 2);
    assert.equal(list.body.items.filter((item) => item.current).length, 1);
    assert.equal(
      await prisma.refreshSession.count({ where: { userId: admin.id, scope: 'APP' } }),
      1,
    );
    assert.ok(first && second);
  });

  await it('encerra uma sessão escolhida e ela para de funcionar na hora', async () => {
    const admin = await createAdmin();
    const victim = await signIn(admin);
    const current = await signIn(admin);
    const list = await current.get('/admin/sessions');
    const other = list.body.items.find((item) => !item.current);
    const removed = await current.delete(`/admin/sessions/${other.id}`);
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    const after = await victim.get('/admin/dashboard/summary');
    assert.ok([401, 403].includes(after.status), `esperava 401/403, veio ${after.status}`);
    assert.equal((await current.get('/admin/dashboard/summary')).status, 200);
  });

  await it('encerrar as outras preserva a atual', async () => {
    const admin = await createAdmin();
    await signIn(admin);
    await signIn(admin);
    const current = await signIn(admin);
    const result = await current.post('/admin/sessions/revoke-others');
    assert.equal(result.status, 200);
    assert.equal(result.body.revoked, 2);
    assert.equal((await current.get('/admin/dashboard/summary')).status, 200);
    assert.equal((await current.get('/admin/sessions')).body.items.length, 1);
  });

  await it('gestor derruba as sessões de outro administrador, com reautenticação', async () => {
    const manager = await createAdmin();
    const other = await createAdmin({ permissions: ['VIEW_REPORTS'] });
    const otherPanel = await signIn(other);
    const panel = await signIn(manager);
    const semReauth = await panel.post(`/admin/admins/${other.id}/sessions/revoke`, { body: {} });
    assert.equal(semReauth.status, 400);
    const ok = await panel.post(`/admin/admins/${other.id}/sessions/revoke`, {
      body: await reauth(manager),
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const after = await otherPanel.get('/admin/dashboard/summary');
    assert.ok([401, 403].includes(after.status), `esperava 401/403, veio ${after.status}`);
  });

  console.log('\nAuditoria e segredos');

  await it('a auditoria registra os eventos sensíveis sem token, código ou segredo', async () => {
    const audits = await prisma.auditLog.findMany({
      where: { entityType: { in: ['AdminInvite', 'User', 'AdminMfaRecovery', 'RefreshSession'] } },
      select: { action: true, metadata: true },
    });
    const actions = new Set(audits.map((entry) => entry.action));
    for (const action of [
      'ADMIN_INVITE_CREATED',
      'ADMIN_INVITE_EMAIL_CONFIRMED',
      'ADMIN_INVITE_PASSWORD_SET',
      'ADMIN_INVITE_ACCEPTED',
      'ADMIN_INVITE_REVOKED',
      'ADMIN_PERMISSIONS_CHANGED',
      'ADMIN_ACCESS_REVOKED',
      'ADMIN_PASSWORD_RESET_REQUESTED',
      'ADMIN_PASSWORD_RESET_COMPLETED',
      'ADMIN_MFA_RECOVERY_REQUESTED',
      'ADMIN_MFA_RECOVERY_APPROVED',
      'ADMIN_MFA_RECOVERY_REJECTED',
      'ADMIN_MFA_RECOVERY_STARTED',
      'ADMIN_MFA_RECOVERY_COMPLETED',
      'ADMIN_SESSION_REVOKED',
      'ADMIN_SESSIONS_REVOKED_OTHERS',
      'ADMIN_SESSIONS_REVOKED_BY_MANAGER',
      'ADMIN_REAUTH_FAILED',
      'ADMIN_LOGIN',
    ])
      assert.ok(actions.has(action), `falta o evento ${action} na auditoria`);

    const dump = JSON.stringify(audits);
    for (const token of outbox
      .map((message) => message.text.match(/token=([\w-]+)/)?.[1])
      .filter(Boolean))
      assert.ok(!dump.includes(token), 'token de link não pode estar na auditoria');
    assert.ok(!/\b\d{6}\b/.test(dump), 'nenhum código de seis dígitos na auditoria');
    const secrets = await prisma.twoFactorAuth.findMany({ select: { secret: true } });
    for (const { secret } of secrets) assert.ok(!dump.includes(secret));
  });

  await it('o segredo do segundo fator fica cifrado no banco', async () => {
    const rows = await prisma.twoFactorAuth.findMany({ select: { secret: true } });
    assert.ok(rows.length);
    for (const { secret } of rows)
      assert.match(secret, /^[\w-]+\.[\w-]+\.[\w-]+$/, 'formato iv.tag.payload do AES-GCM');
  });

  await it('o aplicativo dos estudantes continua intacto', async () => {
    const student = await createUser();
    const login = await http
      .post(`${API}/auth/login`)
      .set('X-Forwarded-For', nextIp())
      .send({ email: student.email, password: PASSWORD });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    assert.ok(login.body.accessToken);
    const policy = await http.get(`${API}/auth/registration-policy`);
    assert.equal(policy.status, 200);
    // Sessão criada pelo aplicativo nasce com escopo APP e não aparece no painel.
    const sessions = await prisma.refreshSession.findMany({ where: { userId: student.id } });
    assert.ok(sessions.length);
    assert.ok(sessions.every((session) => session.scope === 'APP'));
    // E o Bearer do aplicativo não abre rota administrativa.
    const denied = await http
      .get(`${API}/admin/dashboard/summary`)
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    assert.ok([401, 403].includes(denied.status), `esperava 401/403, veio ${denied.status}`);
  });

  await app.close();
  // A mesma guarda localhost/_test usada antes do TRUNCATE inicial protege o cleanup.
  await prisma.$executeRawUnsafe(
    'TRUNCATE users, audit_logs, admin_invites, admin_access, admin_password_resets, admin_mfa_recoveries RESTART IDENTITY CASCADE',
  );
  await prisma.$disconnect();
  console.log(`\n${results.passed} passaram, ${results.failed.length} falharam`);
  if (results.failed.length) {
    console.log(results.failed.map((name) => `  - ${name}`).join('\n'));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
