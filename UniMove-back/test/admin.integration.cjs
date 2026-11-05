// Testes de ponta a ponta das rotas administrativas contra um PostgreSQL real.
//
// APAGA TODOS OS DADOS do banco apontado por DATABASE_URL. Por isso recusa rodar
// se o host não for local ou se o nome do banco não terminar em _test.
//
// Execução: npm run test:admin-integration
require('dotenv/config');
const assert = require('node:assert/strict');
const { randomInt, randomUUID } = require('node:crypto');

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
process.env.TWO_FACTOR_ENCRYPTION_KEY = 'integration-only-two-factor-key-0123456789';
process.env.JWT_ACCESS_SECRET ??= 'integration-only-access-secret-0123456789';
process.env.JWT_REFRESH_SECRET ??= 'integration-only-refresh-secret-012345678';
process.env.ALLOWED_INSTITUTIONAL_EMAIL_DOMAINS ??= 'ucb.edu.br';
process.env.SMTP_HOST = '';
process.env.TWILIO_ACCOUNT_SID = '';

const argon2 = require('argon2');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const { generate, generateSecret } = require('otplib');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { PrismaPg } = require('@prisma/adapter-pg');
const { AppModule } = require('../dist/src/app.module.js');
const { HttpExceptionFilter } = require('../dist/src/common/filters/http-exception.filter.js');
const { PrismaClient } = require('../dist/src/generated/prisma/client.js');
const { encryptTwoFactorSecret } = require('../dist/src/modules/auth/two-factor-crypto.js');
const { AdminEnrollmentService } = require('../dist/src/modules/admin/admin-enrollment.service.js');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const API = '/api/v1';
const PASSWORD = 'SenhaForte123!';
let http;
let passwordHash;
let serial = 0;
const results = { passed: 0, failed: [] };

async function it(name, run) {
  try {
    await run();
    results.passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    results.failed.push(name);
    console.log(
      `  FAIL ${name}\n       ${error.message.split('\n').slice(0, 6).join('\n       ')}`,
    );
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
function nextIp() {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
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

const createAdmin = (data = {}) => createUser({ roles: ['ADMIN'], twoFactor: true, ...data });

/** Navegador mínimo: guarda cookies, reenvia e manda Origin e CSRF como o painel. */
class Panel {
  jar = new Map();
  raw = [];
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
    const cookies = response.headers['set-cookie'] ?? [];
    for (const line of cookies) {
      this.raw.push(line);
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
}

async function signIn(admin) {
  const panel = new Panel();
  const login = await panel.post('/admin/auth/login', {
    body: { email: admin.email, password: PASSWORD },
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.step, 'TWO_FACTOR');
  const verified = await panel.post('/admin/auth/two-factor', {
    body: { code: await generate({ secret: admin.secret }) },
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  return panel;
}

async function bearerLogin(user, twoFactorCode) {
  const response = await http
    .post(`${API}/auth/login`)
    .set('X-Forwarded-For', nextIp())
    .send({ email: user.email, password: PASSWORD, ...(twoFactorCode ? { twoFactorCode } : {}) });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

async function createRideFixture(driver, { departureAt, status = 'OPEN', seats = 3 } = {}) {
  const [origin, destination] = await prisma.location.findMany({
    take: 2,
    orderBy: { name: 'asc' },
  });
  const vehicle = await prisma.vehicle.create({
    data: {
      ownerId: driver.id,
      brand: 'Honda',
      model: 'Fit',
      color: 'Prata',
      plate: `TST${randomInt(1000, 9999)}${randomUUID().slice(0, 4)}`,
      year: 2022,
      passengerCapacity: 4,
    },
  });
  const route = await prisma.routeTemplate.create({
    data: {
      driverId: driver.id,
      vehicleId: vehicle.id,
      originLocationId: origin.id,
      destinationLocationId: destination.id,
      departureTime: '18:00',
      availableSeats: seats,
    },
  });
  return prisma.ride.create({
    data: {
      routeTemplateId: route.id,
      driverId: driver.id,
      vehicleId: vehicle.id,
      originLocationId: origin.id,
      destinationLocationId: destination.id,
      departureAt: departureAt ?? new Date(Date.now() + 2 * 86400000 + serial++ * 60000),
      totalSeats: seats,
      availableSeats: seats,
      pricePerPersonCents: 800,
      status,
    },
  });
}

async function reserve(ride, passenger, seats = 1) {
  const req = await prisma.rideRequest.create({
    data: {
      rideId: ride.id,
      passengerId: passenger.id,
      seatsRequested: seats,
      status: 'ACCEPTED',
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  await prisma.ride.update({
    where: { id: ride.id },
    data: { availableSeats: { decrement: seats } },
  });
  return prisma.rideReservation.create({
    data: { rideId: ride.id, passengerId: passenger.id, requestId: req.id, seats },
  });
}

async function main() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  http = request(app.getHttpServer());

  await prisma.$executeRawUnsafe(
    'TRUNCATE users, roles, locations, audit_logs RESTART IDENTITY CASCADE',
  );
  for (const name of ['PASSENGER', 'DRIVER', 'ADMIN']) await prisma.role.create({ data: { name } });
  await prisma.location.createMany({
    data: [{ name: 'Águas Claras' }, { name: 'UCB Taguatinga' }],
  });
  passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

  console.log('\nAutorização');
  const student = await createUser();
  const studentToken = (await bearerLogin(student)).accessToken;

  await it('sem autenticação recebe 401', async () => {
    assert.equal((await http.get(`${API}/admin/users`)).status, 401);
    assert.equal((await http.get(`${API}/admin/academic-verifications`)).status, 401);
    assert.equal((await http.get(`${API}/admin/dashboard/summary`)).status, 401);
  });

  await it('usuário sem ADMIN recebe 403 em todas as rotas administrativas', async () => {
    for (const path of ['users', 'rides', 'incidents', 'audit-logs', 'dashboard/summary']) {
      const response = await http
        .get(`${API}/admin/${path}`)
        .set('Authorization', `Bearer ${studentToken}`);
      assert.equal(response.status, 403, path);
    }
  });

  await it('admin do app revisa vínculos sem perfil acadêmico, mas não recebe acesso ao painel', async () => {
    const admin = await createAdmin();
    const code = await generate({ secret: admin.secret });
    const { accessToken } = await bearerLogin(admin, code);
    const response = await http
      .get(`${API}/admin/academic-verifications`)
      .set('Authorization', `Bearer ${accessToken}`);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(Array.isArray(response.body));
    const denied = await http.get(`${API}/admin/users`).set('Authorization', `Bearer ${accessToken}`);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'ADMIN_COOKIE_SESSION_REQUIRED');
  });

  await it('admin sem fator ativo não obtém tokens do app; Bearer antigo sem MFA não revisa vínculos', async () => {
    const admin = await createUser({ roles: ['ADMIN'] });
    const login = await http.post(`${API}/auth/login`).send({ email: admin.email, password: PASSWORD });
    assert.equal(login.status, 403);
    assert.equal(login.body.code, 'ADMIN_ENROLLMENT_REQUIRED');
    assert.equal(login.body.accessToken, undefined);
    const accessToken = await moduleRef.get(require('@nestjs/jwt').JwtService).signAsync({ sub: admin.id, roles: ['ADMIN'], type: 'access', mfa: false }, { secret: process.env.JWT_ACCESS_SECRET });
    const response = await http
      .get(`${API}/admin/academic-verifications`)
      .set('Authorization', `Bearer ${accessToken}`);
    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'ADMIN_2FA_REQUIRED');
  });

  await it('login do app: código reutilizado e força bruta de TOTP são barrados', async () => {
    const admin = await createAdmin();
    const code = await generate({ secret: admin.secret });
    await bearerLogin(admin, code);
    const send = (twoFactorCode) =>
      http
        .post(`${API}/auth/login`)
        .set('X-Forwarded-For', nextIp())
        .send({ email: admin.email, password: PASSWORD, twoFactorCode });
    assert.equal((await send(code)).status, 401, 'código já usado');
    let last;
    // O código reutilizado já contou como a primeira das 8 falhas.
    for (let attempt = 0; attempt < 7; attempt += 1) last = await send('000000');
    assert.equal(last.status, 401);
    const locked = await send('000000');
    assert.equal(locked.status, 429);
    assert.equal(locked.body.code, 'ADMIN_LOGIN_LOCKED');
    const valid = await generate({
      secret: admin.secret,
      epoch: Math.floor(Date.now() / 1000) + 30,
    });
    assert.equal((await send(valid)).status, 429, 'trava vale mesmo com o código certo');
    assert.ok(
      (await prisma.auditLog.count({
        where: { actorUserId: admin.id, action: 'ADMIN_2FA_FAILED' },
      })) > 0,
    );
  });

  await it('contrato do app móvel segue valendo: verificações em array e sem status', async () => {
    const admin = await createAdmin();
    const { accessToken } = await bearerLogin(admin, await generate({ secret: admin.secret }));
    const pending = await createUser({ studentNumber: '2023000001', course: 'Direito' });
    await prisma.academicVerification.create({
      data: { userId: pending.id, reportGuid: randomUUID() },
    });
    const response = await http
      .get(`${API}/admin/academic-verifications?page=1&limit=50`)
      .set('Authorization', `Bearer ${accessToken}`);
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body));
    assert.ok(response.body.some((item) => item.userId === pending.id));
    assert.ok(response.body.every((item) => item.status === 'PENDING_REVIEW'));
    assert.equal(response.headers['x-total-count'], String(response.body.length));
  });

  console.log('\nSessão do painel');
  await it('login recusa origem ausente ou desconhecida', async () => {
    const admin = await createAdmin();
    const body = { email: admin.email, password: PASSWORD };
    assert.equal((await new Panel().post('/admin/auth/login', { body, origin: null })).status, 403);
    const evil = await new Panel().post('/admin/auth/login', { body, origin: 'http://evil.test' });
    assert.equal(evil.status, 403);
    assert.equal(evil.body.code, 'ADMIN_ORIGIN_REJECTED');
  });

  await it('senha errada 401; não admin com senha certa 403 e sem cookie', async () => {
    const admin = await createAdmin();
    const wrong = await new Panel().post('/admin/auth/login', {
      body: { email: admin.email, password: 'Errada123!' },
    });
    assert.equal(wrong.status, 401);
    const panel = new Panel();
    const denied = await panel.post('/admin/auth/login', {
      body: { email: student.email, password: PASSWORD },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'ADMIN_ACCESS_DENIED');
    assert.equal(panel.jar.size, 0);
  });

  await it('senha sozinha não abre sessão: nenhum cookie de acesso antes do 2FA', async () => {
    const admin = await createAdmin();
    const panel = new Panel();
    await panel.post('/admin/auth/login', { body: { email: admin.email, password: PASSWORD } });
    assert.ok(!panel.jar.has('uc_admin_at'));
    assert.equal((await panel.get('/admin/users')).status, 401);
  });

  await it('provisionamento de operador ativa o 2FA; senha sozinha nunca entrega QR ou segredo', async () => {
    const admin = await createUser({ roles: ['ADMIN'] });
    const panel = new Panel();
    const login = await panel.post('/admin/auth/login', {
      body: { email: admin.email, password: PASSWORD },
    });
    assert.equal(login.status, 403);
    assert.equal(login.body.code, 'ADMIN_ENROLLMENT_REQUIRED');
    assert.equal(login.body.enrollment, undefined);
    assert.equal(panel.jar.size, 0);
    const enrollmentService = moduleRef.get(AdminEnrollmentService);
    const enrollment = await enrollmentService.begin(admin.email);
    assert.ok(enrollment.qrCode.startsWith('data:image/png'));
    const wrong = await panel.post('/admin/auth/two-factor', { body: { code: '000000' } });
    assert.equal(wrong.status, 401);
    assert.equal(
      (await prisma.twoFactorAuth.findUnique({ where: { userId: admin.id } })).enabled,
      false,
    );
    const done = await enrollmentService.confirm(admin.email, await generate({ secret: enrollment.secret }));
    assert.equal(done.recoveryCodes.length, 8);
    const stored = await prisma.twoFactorAuth.findUnique({ where: { userId: admin.id } });
    assert.equal(stored.enabled, true);
    assert.ok(!stored.recoveryCodes.includes(done.recoveryCodes[0]));
    assert.ok(!stored.secret.includes(enrollment.secret));
    await assert.rejects(enrollmentService.begin(admin.email), /ativ|configur/i);

    const again = new Panel();
    await again.post('/admin/auth/login', { body: { email: admin.email, password: PASSWORD } });
    const recovered = await again.post('/admin/auth/two-factor', {
      body: { code: done.recoveryCodes[0] },
    });
    assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
    assert.equal(recovered.body.recoveryCodesRemaining, 7);
    assert.equal(recovered.body.user.recoveryCodesRemaining, 7);
    const twice = new Panel();
    await twice.post('/admin/auth/login', { body: { email: admin.email, password: PASSWORD } });
    const reused = await twice.post('/admin/auth/two-factor', {
      body: { code: done.recoveryCodes[0] },
    });
    assert.equal(reused.status, 401, 'código de recuperação vale uma vez');
  });

  await it('código TOTP não pode ser reutilizado', async () => {
    const admin = await createAdmin();
    const code = await generate({ secret: admin.secret });
    const first = new Panel();
    await first.post('/admin/auth/login', { body: { email: admin.email, password: PASSWORD } });
    assert.equal((await first.post('/admin/auth/two-factor', { body: { code } })).status, 200);
    const second = new Panel();
    await second.post('/admin/auth/login', { body: { email: admin.email, password: PASSWORD } });
    assert.equal((await second.post('/admin/auth/two-factor', { body: { code } })).status, 401);
  });

  const mainAdmin = await createAdmin();
  const panel = await signIn(mainAdmin);

  await it('cookies têm HttpOnly e SameSite=Strict; só o CSRF é legível', async () => {
    const lines = panel.raw;
    for (const name of ['uc_admin_at', 'uc_admin_rt']) {
      const line = lines.find((item) => item.startsWith(`${name}=`));
      assert.match(line, /HttpOnly/);
      assert.match(line, /SameSite=Strict/);
    }
    assert.match(
      lines.find((item) => item.startsWith('uc_admin_rt=')),
      /Path=\/api\/v1\/admin\/auth/,
    );
    assert.doesNotMatch(
      lines.find((item) => item.startsWith('uc_admin_csrf=')),
      /HttpOnly/,
    );
  });

  await it('a resposta de login não expõe tokens no corpo', async () => {
    const admin = await createAdmin();
    const fresh = new Panel();
    await fresh.post('/admin/auth/login', { body: { email: admin.email, password: PASSWORD } });
    const response = await fresh.post('/admin/auth/two-factor', {
      body: { code: await generate({ secret: admin.secret }) },
    });
    const text = JSON.stringify(response.body);
    assert.ok(!text.includes('accessToken') && !text.includes('refreshToken'));
    assert.ok(!text.includes(fresh.jar.get('uc_admin_at')));
  });

  await it('sessão lê o administrador e não devolve credenciais', async () => {
    const response = await panel.get('/admin/auth/session');
    assert.equal(response.status, 200);
    assert.equal(response.body.email, mainAdmin.email);
    assert.equal(response.body.twoFactorEnabled, true);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.ok(!JSON.stringify(response.body).match(/passwordHash|cpf|secret/i));
  });

  await it('cookie de sessão não vale fora das rotas administrativas', async () => {
    assert.equal((await panel.get('/users/me')).status, 401);
  });

  await it('token da sessão do painel não vale como Bearer', async () => {
    const response = await http
      .get(`${API}/admin/users`)
      .set('Authorization', `Bearer ${panel.jar.get('uc_admin_at')}`);
    assert.equal(response.status, 401);
  });

  await it('escrita sem CSRF ou de outra origem é recusada antes de agir', async () => {
    const target = await createUser();
    const body = { status: 'SUSPENDED', reason: 'Teste de CSRF' };
    const noToken = await panel.patch(`/admin/users/${target.id}/status`, { body, csrf: false });
    assert.equal(noToken.status, 403);
    assert.equal(noToken.body.code, 'ADMIN_CSRF_REJECTED');
    const evil = await panel.patch(`/admin/users/${target.id}/status`, {
      body,
      origin: 'http://evil.test',
    });
    assert.equal(evil.status, 403);
    assert.equal(evil.body.code, 'ADMIN_ORIGIN_REJECTED');
    assert.equal((await prisma.user.findUnique({ where: { id: target.id } })).status, 'ACTIVE');
  });

  await it('refresh troca os cookies e o token antigo volta como reuso e derruba a família', async () => {
    const admin = await createAdmin();
    const session = await signIn(admin);
    const oldRefresh = session.jar.get('uc_admin_rt');
    const oldAccess = session.jar.get('uc_admin_at');
    const refreshed = await session.post('/admin/auth/refresh');
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
    assert.notEqual(session.jar.get('uc_admin_rt'), oldRefresh);
    assert.equal((await session.get('/admin/auth/session')).status, 200);

    const stale = new Panel();
    stale.jar.set('uc_admin_at', oldAccess);
    assert.equal((await stale.get('/admin/auth/session')).status, 401, 'access da sessão trocada');

    const replay = new Panel();
    replay.jar.set('uc_admin_rt', oldRefresh);
    replay.jar.set('uc_admin_csrf', 'x');
    assert.equal((await replay.post('/admin/auth/refresh')).status, 401);
    // Dentro da janela de disputa entre abas a sessão nova continua válida.
    assert.equal((await session.get('/admin/auth/session')).status, 200);
    // Passada a janela, o mesmo token derruba tudo.
    await prisma.refreshSession.updateMany({
      where: { userId: admin.id, revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 3600000) },
    });
    assert.equal((await replay.post('/admin/auth/refresh')).status, 401);
    assert.equal((await session.get('/admin/auth/session')).status, 401, 'família revogada');
    const events = await prisma.auditLog.count({
      where: { actorUserId: admin.id, action: 'ADMIN_SESSION_REUSE_DETECTED' },
    });
    assert.equal(events, 1);
  });

  await it('refresh de painel não é aceito na rota do app, nem o contrário', async () => {
    const admin = await createAdmin();
    const session = await signIn(admin);
    const mobile = await http
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: session.jar.get('uc_admin_rt') });
    assert.equal(mobile.status, 401);
  });

  await it('refresh legado de estudante promovido a ADMIN exige novo login com MFA', async () => {
    const subject = await createUser();
    const mobile = await bearerLogin(subject);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
    await prisma.userRole.create({ data: { userId: subject.id, roleId: role.id } });
    const response = await http.post(`${API}/auth/refresh`).send({ refreshToken: mobile.refreshToken });
    assert.equal(response.status, 401);
    assert.equal(response.body.code, 'ADMIN_2FA_REQUIRED');
    assert.equal(response.body.accessToken, undefined);
    assert.equal(await prisma.refreshSession.count({ where: { userId: subject.id, revokedAt: null } }), 0);
  });

  await it('refresh do app recusa ADMIN cujo segundo fator foi desativado no banco', async () => {
    const admin = await createAdmin();
    const mobile = await bearerLogin(admin, await generate({ secret: admin.secret }));
    await prisma.twoFactorAuth.update({ where: { userId: admin.id }, data: { enabled: false } });
    const response = await http.post(`${API}/auth/refresh`).send({ refreshToken: mobile.refreshToken });
    assert.equal(response.status, 401);
    assert.equal(response.body.code, 'ADMIN_2FA_REQUIRED');
  });

  await it('refresh do painel respeita expiração do banco antecipada sem alterar o JWT', async () => {
    const admin = await createAdmin();
    const session = await signIn(admin);
    await prisma.refreshSession.updateMany({ where: { userId: admin.id, revokedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const response = await session.post('/admin/auth/refresh');
    assert.equal(response.status, 401);
    assert.equal((await session.get('/admin/auth/session')).status, 401);
  });

  await it('logout encerra de imediato, mesmo com o access token copiado antes', async () => {
    const admin = await createAdmin();
    const session = await signIn(admin);
    const copied = session.jar.get('uc_admin_at');
    assert.equal((await session.post('/admin/auth/logout')).status, 204);
    assert.equal(session.jar.size, 0);
    const replay = new Panel();
    replay.jar.set('uc_admin_at', copied);
    assert.equal((await replay.get('/admin/auth/session')).status, 401);
  });

  console.log('\nRevogação e estado da conta');
  await it('revogar ADMIN vale na hora, com tokens já emitidos', async () => {
    const admin = await createAdmin();
    const session = await signIn(admin);
    const bearer = (
      await bearerLogin(
        admin,
        await generate({ secret: admin.secret, epoch: Math.floor(Date.now() / 1000) + 30 }),
      )
    ).accessToken;
    assert.equal((await session.get('/admin/users')).status, 200);
    await prisma.userRole.deleteMany({ where: { userId: admin.id } });
    assert.equal((await session.get('/admin/users')).status, 403);
    const viaBearer = await http.get(`${API}/admin/users`).set('Authorization', `Bearer ${bearer}`);
    assert.equal(viaBearer.status, 403);
    assert.equal((await session.post('/admin/auth/refresh')).status, 401);
  });

  await it('conta suspensa para de operar na próxima requisição', async () => {
    const admin = await createAdmin();
    const session = await signIn(admin);
    await prisma.user.update({ where: { id: admin.id }, data: { status: 'SUSPENDED' } });
    assert.equal((await session.get('/admin/users')).status, 401);
    assert.equal((await session.post('/admin/auth/refresh')).status, 401);
  });

  await it('desativar o 2FA derruba o acesso administrativo do token antigo', async () => {
    const admin = await createAdmin();
    const session = await signIn(admin);
    await prisma.twoFactorAuth.update({ where: { userId: admin.id }, data: { enabled: false } });
    const response = await session.get('/admin/users');
    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'ADMIN_2FA_REQUIRED');
  });

  await it('admin não configura ou desativa segundo fator pelos endpoints do app', async () => {
    const admin = await createAdmin();
    const { accessToken } = await bearerLogin(admin, await generate({ secret: admin.secret }));
    const setup = await http
      .post(`${API}/users/me/two-factor/setup`)
      .set('Authorization', `Bearer ${accessToken}`);
    assert.equal(setup.status, 403);
    assert.equal(
      (await prisma.twoFactorAuth.findUnique({ where: { userId: admin.id } })).enabled,
      true,
    );
    const disable = await http
      .post(`${API}/users/me/two-factor/disable`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: PASSWORD });
    assert.equal(disable.status, 403);
    assert.equal(disable.body.code, 'ADMIN_ENROLLMENT_REQUIRED');
    assert.equal(
      (await prisma.twoFactorAuth.findUnique({ where: { userId: admin.id } })).enabled,
      true,
    );
  });

  console.log('\nGestão de usuários');
  await it('estudante mantém configuração, ativação, login e desativação de 2FA pelo app', async () => {
    const student = await createUser();
    const { accessToken } = await bearerLogin(student);
    const setup = await http.post(`${API}/users/me/two-factor/setup`).set('Authorization', `Bearer ${accessToken}`);
    assert.equal(setup.status, 201, JSON.stringify(setup.body));
    const code = await generate({ secret: setup.body.secret });
    const enabled = await http.post(`${API}/users/me/two-factor/enable`).set('Authorization', `Bearer ${accessToken}`).send({ code });
    assert.equal(enabled.status, 201, JSON.stringify(enabled.body));
    assert.equal(enabled.body.enabled, true);
    await bearerLogin(student, code);
    const disabled = await http.post(`${API}/users/me/two-factor/disable`).set('Authorization', `Bearer ${accessToken}`).send({ password: PASSWORD });
    assert.equal(disabled.status, 201, JSON.stringify(disabled.body));
    assert.equal(disabled.body.enabled, false);
  });
  await it('senha errada no app também bloqueia o login do painel para a mesma conta', async () => {
    const admin = await createAdmin();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await http.post(`${API}/auth/login`).set('X-Forwarded-For', nextIp()).send({ email: admin.email, password: 'SenhaIncorreta123!' });
      assert.equal(response.status, 401);
    }
    const blocked = await new Panel().post('/admin/auth/login', { body: { email: admin.email, password: PASSWORD } });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.code, 'ADMIN_LOGIN_LOCKED');
  });
  await it('listas e detalhes nunca trazem hash de senha nem CPF', async () => {
    const target = await createUser({ phone: '61999990000' });
    const responses = [
      await panel.get('/admin/users?limit=100'),
      await panel.get(`/admin/users/${target.id}`),
      await panel.patch(`/admin/users/${target.id}/status`, {
        body: { status: 'SUSPENDED', reason: 'Conferir retorno seguro' },
      }),
    ];
    for (const response of responses) {
      assert.equal(response.status, 200, JSON.stringify(response.body));
      const text = JSON.stringify(response.body);
      assert.ok(!/passwordHash|password_hash|"cpf"|"phone"|argon2/.test(text), text.slice(0, 300));
      assert.ok(!text.includes(target.cpf));
    }
  });

  await it('paginação, busca e filtros vêm do banco', async () => {
    const needle = await createUser({ fullName: 'Agulha Palheiro Silva', course: 'Direito' });
    await prisma.academicVerification.create({
      data: { userId: needle.id, reportGuid: randomUUID(), status: 'APPROVED' },
    });
    const found = await panel.get('/admin/users?q=palheiro');
    assert.deepEqual(
      found.body.map((item) => item.id),
      [needle.id],
    );
    assert.equal(found.body[0].verificationStatus, 'APPROVED');
    assert.equal(found.headers['x-total-count'], '1');
    const page = await panel.get('/admin/users?limit=2&page=1');
    assert.equal(page.body.length, 2);
    assert.ok(Number(page.headers['x-total-count']) > 2);
    const filtered = await panel.get('/admin/users?verification=APPROVED&q=agulha');
    assert.equal(filtered.body.length, 1);
    const none = await panel.get('/admin/users?status=BLOCKED&q=agulha');
    assert.equal(none.body.length, 0);
    assert.equal((await panel.get('/admin/users?limit=9999')).status, 400);
  });

  await it('alteração exige motivo e não aceita DEACTIVATED', async () => {
    const target = await createUser();
    const url = `/admin/users/${target.id}/status`;
    assert.equal((await panel.patch(url, { body: { status: 'SUSPENDED' } })).status, 400);
    assert.equal(
      (await panel.patch(url, { body: { status: 'DEACTIVATED', reason: 'Tentativa inválida' } }))
        .status,
      400,
    );
    assert.equal(
      (await panel.patch(url, { body: { status: 'SUSPENDED', reason: 'abc' } })).status,
      400,
    );
    assert.equal((await panel.get('/admin/users/nao-e-uuid')).status, 400);
    assert.equal((await panel.get(`/admin/users/${randomUUID()}`)).status, 404);
  });

  await it('conta excluída não reativa por alteração de status', async () => {
    const gone = await createUser({ status: 'DEACTIVATED', deletedAt: new Date() });
    const response = await panel.patch(`/admin/users/${gone.id}/status`, {
      body: { status: 'ACTIVE', reason: 'Tentando reativar excluída' },
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'ACCOUNT_DEACTIVATED');
    assert.equal((await prisma.user.findUnique({ where: { id: gone.id } })).status, 'DEACTIVATED');
  });

  await it('suspender grava auditoria com motivo e revoga sessões da conta', async () => {
    const target = await createUser();
    const { accessToken, refreshToken } = await bearerLogin(target);
    const response = await panel.patch(`/admin/users/${target.id}/status`, {
      body: { status: 'SUSPENDED', reason: 'Conduta sob análise' },
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const log = await prisma.auditLog.findFirst({
      where: { entityId: target.id, action: 'ADMIN_USER_SUSPENDED' },
    });
    assert.equal(log.actorUserId, mainAdmin.id);
    assert.equal(log.metadata.reason, 'Conduta sob análise');
    assert.equal(log.metadata.previousStatus, 'ACTIVE');
    assert.equal(
      await prisma.refreshSession.count({ where: { userId: target.id, revokedAt: null } }),
      0,
    );
    const usage = await http.get(`${API}/users/me`).set('Authorization', `Bearer ${accessToken}`);
    assert.equal(usage.status, 401);
    assert.equal((await http.post(`${API}/auth/refresh`).send({ refreshToken })).status, 401);

    const back = await panel.patch(`/admin/users/${target.id}/status`, {
      body: { status: 'ACTIVE', reason: 'Análise concluída' },
    });
    assert.equal(back.status, 200);
    assert.equal(back.body.status, 'ACTIVE');
  });

  await it('impede administrador de alterar a própria situação', async () => {
    const response = await panel.patch(`/admin/users/${mainAdmin.id}/status`, {
      body: { status: 'SUSPENDED', reason: 'Tentando me suspender' },
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'CANNOT_CHANGE_OWN_STATUS');
  });

  await it('dois admins suspendendo um ao outro: sobra pelo menos um', async () => {
    // Isola o cenário: só estes dois são administradores válidos.
    await prisma.twoFactorAuth.updateMany({ data: { enabled: false } });
    try {
      const [one, two] = [await createAdmin(), await createAdmin()];
      const [panelOne, panelTwo] = [await signIn(one), await signIn(two)];
      const body = { status: 'SUSPENDED', reason: 'Disputa simultânea' };
      const responses = await Promise.all([
        panelOne.patch(`/admin/users/${two.id}/status`, { body }),
        panelTwo.patch(`/admin/users/${one.id}/status`, { body }),
      ]);
      assert.equal(
        responses.filter((item) => item.status === 200).length,
        1,
        JSON.stringify(responses.map((r) => r.body)),
      );
      const remaining = await prisma.user.count({
        where: {
          status: 'ACTIVE',
          roles: { some: { role: { name: 'ADMIN' } } },
          twoFactor: { is: { enabled: true } },
        },
      });
      assert.equal(remaining, 1);
      await prisma.user.updateMany({
        where: { id: { in: [one.id, two.id] } },
        data: { status: 'ACTIVE' },
      });
    } finally {
      await prisma.twoFactorAuth.updateMany({
        where: { userId: mainAdmin.id },
        data: { enabled: true },
      });
    }
  });

  await it('último admin válido não apaga a própria conta nem é restringido', async () => {
    await prisma.twoFactorAuth.updateMany({ data: { enabled: false } });
    try {
      const last = await createAdmin();
      const { accessToken } = await bearerLogin(last, await generate({ secret: last.secret }));
      const removal = await http
        .delete(`${API}/users/me`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: PASSWORD });
      assert.equal(removal.status, 409, JSON.stringify(removal.body));
      assert.equal(removal.body.code, 'LAST_ADMIN');
      assert.equal((await prisma.user.findUnique({ where: { id: last.id } })).deletedAt, null);
    } finally {
      await prisma.twoFactorAuth.updateMany({
        where: { userId: mainAdmin.id },
        data: { enabled: true },
      });
    }
  });

  await it('admin que exclui a conta não apaga o rastro das decisões', async () => {
    const admin = await createAdmin();
    const target = await createUser();
    const session = await signIn(admin);
    const decision = await session.patch(`/admin/users/${target.id}/status`, {
      body: { status: 'SUSPENDED', reason: 'Decisão que precisa permanecer' },
    });
    assert.equal(decision.status, 200);
    const { accessToken } = await bearerLogin(
      admin,
      await generate({ secret: admin.secret, epoch: Math.floor(Date.now() / 1000) + 30 }),
    );
    const removal = await http
      .delete(`${API}/users/me`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: PASSWORD });
    assert.equal(removal.status, 204, JSON.stringify(removal.body));
    const log = await prisma.auditLog.findFirst({
      where: { entityId: target.id, action: 'ADMIN_USER_SUSPENDED' },
    });
    assert.equal(log.actorUserId, admin.id);
    assert.equal(log.metadata.reason, 'Decisão que precisa permanecer');
    assert.equal(
      (await prisma.user.findUnique({ where: { id: admin.id } })).fullName,
      'Conta excluída',
    );
  });

  await it('limite por conta: tentativas seguidas de senha errada são travadas', async () => {
    const admin = await createAdmin();
    let last;
    for (let attempt = 0; attempt < 9; attempt += 1)
      last = await new Panel().post('/admin/auth/login', {
        body: { email: admin.email, password: 'Errada123!' },
      });
    assert.equal(last.status, 429);
    assert.equal(last.body.code, 'ADMIN_LOGIN_LOCKED');
    const correct = await new Panel().post('/admin/auth/login', {
      body: { email: admin.email, password: PASSWORD },
    });
    assert.equal(correct.status, 429, 'trava vale mesmo com a senha certa');
  });

  console.log('\nConsequências operacionais');
  await it('motorista com carona futura: pede confirmação e depois cancela tudo de verdade', async () => {
    const driver = await createUser({ roles: ['DRIVER', 'PASSENGER'] });
    const passenger = await createUser();
    const ride = await createRideFixture(driver);
    await reserve(ride, passenger);
    const waiting = await createUser();
    const pending = await prisma.rideRequest.create({
      data: {
        rideId: ride.id,
        passengerId: waiting.id,
        seatsRequested: 1,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });

    const impact = await panel.get(`/admin/users/${driver.id}/impact`);
    assert.equal(impact.body.futureRidesAsDriver, 1);
    assert.equal(impact.body.passengersAffected, 1);

    const url = `/admin/users/${driver.id}/status`;
    const unconfirmed = await panel.patch(url, {
      body: { status: 'SUSPENDED', reason: 'Denúncia de segurança' },
    });
    assert.equal(unconfirmed.status, 409);
    assert.equal(unconfirmed.body.code, 'IMPACT_CONFIRMATION_REQUIRED');
    assert.equal((await prisma.ride.findUnique({ where: { id: ride.id } })).status, 'OPEN');

    const confirmed = await panel.patch(url, {
      body: { status: 'SUSPENDED', reason: 'Denúncia de segurança', confirmImpact: true },
    });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.deepEqual(confirmed.body.consequences, {
      ridesCancelled: 1,
      reservationsCancelled: 1,
      requestsCancelled: 1,
    });
    assert.equal(confirmed.body.notificationsDelivered, true);
    assert.equal((await prisma.ride.findUnique({ where: { id: ride.id } })).status, 'CANCELLED');
    assert.equal(
      await prisma.rideReservation.count({ where: { rideId: ride.id, status: 'CONFIRMED' } }),
      0,
    );
    assert.equal(
      (await prisma.rideRequest.findUnique({ where: { id: pending.id } })).status,
      'CANCELLED',
    );
    assert.equal(await prisma.cancellation.count({ where: { rideId: ride.id } }), 1);
    for (const person of [passenger, waiting]) {
      const notice = await prisma.notification.findFirst({
        where: { userId: person.id, type: 'RIDE_CANCELLED', resourceId: ride.id },
      });
      assert.ok(notice, 'participante notificado');
      assert.ok(!notice.message.includes('Denúncia'), 'motivo interno não vaza');
    }
    await panel.patch(url, { body: { status: 'ACTIVE', reason: 'Análise encerrada' } });
    assert.equal((await prisma.ride.findUnique({ where: { id: ride.id } })).status, 'CANCELLED');
  });

  await it('passageiro restringido devolve a vaga ao motorista', async () => {
    const driver = await createUser({ roles: ['DRIVER'] });
    const passenger = await createUser();
    const ride = await createRideFixture(driver, { seats: 3 });
    await reserve(ride, passenger, 2);
    assert.equal((await prisma.ride.findUnique({ where: { id: ride.id } })).availableSeats, 1);
    const response = await panel.patch(`/admin/users/${passenger.id}/status`, {
      body: { status: 'BLOCKED', reason: 'Fraude documental', confirmImpact: true },
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const after = await prisma.ride.findUnique({ where: { id: ride.id } });
    assert.equal(after.availableSeats, 3);
    assert.equal(after.status, 'OPEN');
    assert.ok(
      await prisma.notification.findFirst({ where: { userId: driver.id, resourceId: ride.id } }),
    );
  });

  await it('motorista com carona em andamento não pode ser restringido', async () => {
    const driver = await createUser({ roles: ['DRIVER'] });
    await createRideFixture(driver, { status: 'IN_PROGRESS', departureAt: new Date() });
    const response = await panel.patch(`/admin/users/${driver.id}/status`, {
      body: { status: 'SUSPENDED', reason: 'Tentativa durante viagem', confirmImpact: true },
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'RIDE_IN_PROGRESS');
    assert.equal((await prisma.user.findUnique({ where: { id: driver.id } })).status, 'ACTIVE');
  });

  await it('motorista suspenso não gera carona nova pela busca', async () => {
    const driver = await createUser({ roles: ['DRIVER'], status: 'SUSPENDED' });
    await prisma.driverLicense.create({
      data: { userId: driver.id, image: Buffer.from([1]), sizeBytes: 1 },
    });
    await prisma.academicVerification.create({
      data: { userId: driver.id, reportGuid: randomUUID(), status: 'APPROVED' },
    });
    const ride = await createRideFixture(driver);
    const route = await prisma.routeTemplate.findUnique({ where: { id: ride.routeTemplateId } });
    const seeker = await createAdmin({ profileCompletedAt: new Date() });
    await prisma.routeTemplateWeekday.createMany({
      data: ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'].map(
        (weekday) => ({ routeTemplateId: route.id, weekday }),
      ),
    });
    const { accessToken } = await bearerLogin(seeker, await generate({ secret: seeker.secret }));
    const before = await prisma.ride.count({ where: { driverId: driver.id } });
    const response = await http
      .get(`${API}/matching/search`)
      .set('Authorization', `Bearer ${accessToken}`)
      .query({
        originLocationId: route.originLocationId,
        destinationLocationId: route.destinationLocationId,
        date: '2030-01-15',
        departureTime: '18:00',
        seats: 1,
      });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.length, 0);
    assert.equal(await prisma.ride.count({ where: { driverId: driver.id } }), before);
  });

  console.log('\nAtomicidade');
  await it('falha ao auditar desfaz cancelamentos e mudança de status', async () => {
    const driver = await createUser({ roles: ['DRIVER'] });
    const passenger = await createUser();
    const ride = await createRideFixture(driver);
    await reserve(ride, passenger);
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_audit_for_test() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'falha simulada'; END;
      $$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_audit_for_test BEFORE INSERT ON audit_logs FOR EACH ROW
      EXECUTE FUNCTION fail_audit_for_test();
    `);
    try {
      const response = await panel.patch(`/admin/users/${driver.id}/status`, {
        body: { status: 'SUSPENDED', reason: 'Falha simulada', confirmImpact: true },
      });
      assert.equal(response.status, 500);
      assert.equal(response.body.message, 'Erro interno do servidor.');
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER fail_audit_for_test ON audit_logs');
      await prisma.$executeRawUnsafe('DROP FUNCTION fail_audit_for_test');
    }
    assert.equal((await prisma.user.findUnique({ where: { id: driver.id } })).status, 'ACTIVE');
    const after = await prisma.ride.findUnique({ where: { id: ride.id } });
    assert.equal(after.status, 'OPEN');
    assert.equal(
      await prisma.rideReservation.count({ where: { rideId: ride.id, status: 'CONFIRMED' } }),
      1,
    );
    assert.equal(await prisma.cancellation.count({ where: { rideId: ride.id } }), 0);
    assert.equal(await prisma.notification.count({ where: { resourceId: ride.id } }), 0);
  });

  console.log('\nVerificações acadêmicas');
  const pendingUser = async () => {
    const user = await createUser({
      studentNumber: String(randomInt(1000000000, 1999999999)),
      course: 'Direito',
    });
    await prisma.academicVerification.create({
      data: { userId: user.id, reportGuid: randomUUID() },
    });
    return user;
  };

  await it('lista traz nome, matrícula, curso, e-mail e GUID', async () => {
    const user = await pendingUser();
    const response = await panel.get('/admin/academic-verifications?limit=100');
    const item = response.body.find((row) => row.userId === user.id);
    assert.equal(item.user.studentNumber, user.studentNumber);
    assert.equal(item.user.course, 'Direito');
    assert.equal(item.user.institutionalEmail, user.email);
    assert.ok(item.reportGuid);
  });

  await it('aprovação persiste, registra revisor e auditoria', async () => {
    const user = await pendingUser();
    const response = await panel.patch(`/admin/academic-verifications/${user.id}`, {
      body: { status: 'APPROVED' },
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const row = await prisma.academicVerification.findUnique({ where: { userId: user.id } });
    assert.equal(row.status, 'APPROVED');
    assert.equal(row.reviewedById, mainAdmin.id);
    assert.ok(row.reviewedAt);
    assert.equal(
      await prisma.auditLog.count({
        where: { entityId: user.id, action: 'ACADEMIC_VERIFICATION_APPROVED' },
      }),
      1,
    );
    const decided = await panel.get('/admin/academic-verifications?status=APPROVED&limit=100');
    assert.ok(decided.body.some((item) => item.userId === user.id));
  });

  await it('rejeição exige motivo e nada muda sem ele', async () => {
    const user = await pendingUser();
    const url = `/admin/academic-verifications/${user.id}`;
    for (const reviewNote of [undefined, '   ']) {
      const response = await panel.patch(url, { body: { status: 'REJECTED', reviewNote } });
      assert.equal(response.status, 400);
    }
    assert.equal(
      (await prisma.academicVerification.findUnique({ where: { userId: user.id } })).status,
      'PENDING_REVIEW',
    );
    const ok = await panel.patch(url, {
      body: { status: 'REJECTED', reviewNote: 'GUID não confere' },
    });
    assert.equal(ok.status, 200);
    assert.equal(
      (await prisma.academicVerification.findUnique({ where: { userId: user.id } })).reviewNote,
      'GUID não confere',
    );
  });

  await it('duas decisões simultâneas: uma vence, a outra recebe 409, uma só auditoria', async () => {
    const user = await pendingUser();
    const second = await signIn(await createAdmin());
    const url = `/admin/academic-verifications/${user.id}`;
    const responses = await Promise.all([
      panel.patch(url, { body: { status: 'APPROVED' } }),
      second.patch(url, { body: { status: 'REJECTED', reviewNote: 'Decisão concorrente' } }),
    ]);
    const codes = responses.map((item) => item.status).sort();
    assert.deepEqual(codes, [200, 409], JSON.stringify(responses.map((r) => r.body)));
    const conflict = responses.find((item) => item.status === 409);
    assert.equal(conflict.body.code, 'VERIFICATION_ALREADY_DECIDED');
    const winner = responses.find((item) => item.status === 200);
    const row = await prisma.academicVerification.findUnique({ where: { userId: user.id } });
    assert.equal(row.status, winner.body.status);
    assert.equal(
      await prisma.auditLog.count({
        where: { entityId: user.id, action: { startsWith: 'ACADEMIC_VERIFICATION_' } },
      }),
      1,
    );
  });

  await it('validação inexistente responde 404', async () => {
    const response = await panel.patch(`/admin/academic-verifications/${randomUUID()}`, {
      body: { status: 'APPROVED' },
    });
    assert.equal(response.status, 404);
  });

  console.log('\nCaronas');
  await it('lista e detalhe trazem dados reais, com placa mascarada', async () => {
    const driver = await createUser({ roles: ['DRIVER'], fullName: 'Motorista Listado' });
    const passenger = await createUser();
    const ride = await createRideFixture(driver);
    await reserve(ride, passenger);
    const list = await panel.get('/admin/rides?q=listado');
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].id, ride.id);
    assert.equal(list.body[0].pricePerPersonCents, 800);
    const open = await panel.get('/admin/rides?status=OPEN&q=listado');
    assert.equal(open.body.length, 1);
    assert.equal((await panel.get('/admin/rides?status=CANCELLED&q=listado')).body.length, 0);
    const counts = JSON.parse(list.headers['x-status-counts']);
    assert.ok(counts.OPEN >= 1);

    const detail = await panel.get(`/admin/rides/${ride.id}`);
    assert.equal(detail.body.reservations.length, 1);
    assert.equal(detail.body.reservations[0].passenger.id, passenger.id);
    assert.ok(detail.body.vehicle.plate.includes('•'));
    assert.ok(!JSON.stringify(detail.body).match(/conversation|"cpf"|passwordHash/i));
    assert.equal((await panel.get(`/admin/rides/${randomUUID()}`)).status, 404);
  });

  console.log('\nDenúncias');
  const newIncident = async () => {
    const driver = await createUser({ roles: ['DRIVER'] });
    const reporter = await createUser();
    const ride = await createRideFixture(driver);
    const incident = await prisma.incident.create({
      data: {
        rideId: ride.id,
        reportedById: reporter.id,
        reportedUserId: driver.id,
        type: 'SAFETY_CONCERN',
        description: 'Relato de teste',
      },
    });
    return { incident, reporter };
  };

  await it('lista e detalhe trazem envolvidos, e nenhuma mensagem privada', async () => {
    const { incident, reporter } = await newIncident();
    await prisma.messageConversation.create({
      data: {
        rideId: incident.rideId,
        passengerId: reporter.id,
        messages: { create: { senderId: reporter.id, content: 'mensagem-privada-sigilosa' } },
      },
    });
    const list = await panel.get('/admin/incidents?status=OPEN');
    assert.ok(list.body.some((item) => item.id === incident.id));
    const detail = await panel.get(`/admin/incidents/${incident.id}`);
    assert.equal(detail.body.description, 'Relato de teste');
    assert.equal(detail.body.reportedBy.id, reporter.id);
    assert.ok(!JSON.stringify(detail.body).includes('mensagem-privada-sigilosa'));
    assert.ok(!JSON.stringify(list.body).includes('Relato de teste'));
  });

  await it('decisão final exige justificativa, audita, notifica e não aceita volta', async () => {
    const { incident, reporter } = await newIncident();
    const url = `/admin/incidents/${incident.id}`;
    assert.equal((await panel.patch(url, { body: { status: 'RESOLVED' } })).status, 400);
    assert.equal((await panel.patch(url, { body: { status: 'UNDER_REVIEW' } })).status, 200);
    const resolved = await panel.patch(url, {
      body: { status: 'RESOLVED', note: 'Orientação enviada' },
    });
    assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
    const row = await prisma.incident.findUnique({ where: { id: incident.id } });
    assert.equal(row.status, 'RESOLVED');
    assert.ok(row.resolvedAt);
    const logs = await prisma.auditLog.findMany({
      where: { entityType: 'Incident', entityId: incident.id },
      orderBy: { createdAt: 'desc' },
    });
    assert.equal(logs.length, 2);
    assert.equal(logs[0].metadata.note, 'Orientação enviada');
    const notice = await prisma.notification.findFirst({
      where: { userId: reporter.id, type: 'INCIDENT_UPDATED', resourceId: incident.id },
    });
    assert.ok(notice);
    assert.ok(!JSON.stringify(notice).includes('Orientação enviada'), 'justificativa é interna');
    const reopened = await panel.patch(url, { body: { status: 'UNDER_REVIEW' } });
    assert.equal(reopened.status, 409);
    const detail = await panel.get(url);
    assert.equal(detail.body.decisions.length, 2);
  });

  await it('duas decisões simultâneas sobre a denúncia: uma só vale', async () => {
    const { incident } = await newIncident();
    const second = await signIn(await createAdmin());
    const url = `/admin/incidents/${incident.id}`;
    const responses = await Promise.all([
      panel.patch(url, { body: { status: 'RESOLVED', note: 'Primeira' } }),
      second.patch(url, { body: { status: 'DISMISSED', note: 'Segunda' } }),
    ]);
    assert.deepEqual(responses.map((item) => item.status).sort(), [200, 409]);
    assert.equal(
      await prisma.auditLog.count({ where: { entityType: 'Incident', entityId: incident.id } }),
      1,
    );
  });

  console.log('\nDashboard, auditoria e relatórios');
  await it('resumo bate com o banco', async () => {
    const response = await panel.get('/admin/dashboard/summary');
    assert.equal(response.status, 200);
    assert.equal(
      response.body.users.total,
      await prisma.user.count({ where: { deletedAt: null } }),
    );
    assert.equal(
      response.body.users.active,
      await prisma.user.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
    );
    assert.equal(
      response.body.users.drivers,
      await prisma.user.count({
        where: { deletedAt: null, roles: { some: { role: { name: 'DRIVER' } } } },
      }),
    );
    assert.equal(response.body.rides.open, await prisma.ride.count({ where: { status: 'OPEN' } }));
    assert.equal(
      response.body.verifications.pending,
      await prisma.academicVerification.count({ where: { status: 'PENDING_REVIEW' } }),
    );
    assert.equal(
      response.body.incidents.open,
      await prisma.incident.count({ where: { status: 'OPEN' } }),
    );
  });

  await it('série tem um ponto por dia e conta os cadastros de hoje', async () => {
    const response = await panel.get('/admin/dashboard/series?days=7');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.length, 7);
    const today = response.body.at(-1);
    assert.ok(today.users > 0, JSON.stringify(today));
    assert.ok(today.rides > 0, JSON.stringify(today));
    assert.equal(typeof today.users, 'number');
    assert.equal((await panel.get('/admin/dashboard/series?days=45')).status, 400);
  });

  await it('relatório sem base devolve percentual nulo, não zero inventado', async () => {
    const response = await panel.get('/admin/reports/summary?days=30');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(await prisma.ride.count({ where: { status: 'COMPLETED' } }), 0);
    assert.equal(response.body.completionRate, null);
    assert.equal(response.body.cancellationRate, null);
    assert.equal(response.body.requestAcceptanceRate, 1, 'solicitações aceitas nas fixtures');
    assert.equal(typeof response.body.estimatedValueCents, 'number');
    assert.ok(Array.isArray(response.body.topOrigins));
  });

  await it('auditoria tem filtros e nenhuma rota de escrita', async () => {
    const filtered = await panel.get('/admin/audit-logs?q=ADMIN_USER_SUSPENDED');
    assert.ok(filtered.body.length > 0);
    assert.ok(filtered.body.every((item) => item.action === 'ADMIN_USER_SUSPENDED'));
    assert.ok(filtered.body[0].actor.fullName);
    const byEntity = await panel.get('/admin/audit-logs?entityType=Incident');
    assert.ok(byEntity.body.every((item) => item.entityType === 'Incident'));
    assert.ok(Number(byEntity.headers['x-total-count']) >= byEntity.body.length);
    const id = filtered.body[0].id;
    assert.equal((await panel.send('delete', `/admin/audit-logs/${id}`)).status, 404);
    assert.equal((await panel.patch(`/admin/audit-logs/${id}`, { body: {} })).status, 404);
  });

  await it('CSV não leva CPF, e-mail, matrícula, GUID nem relato; exportar é auditado', async () => {
    const formula = await createUser({
      fullName: '=HYPERLINK("http://evil.test")',
      course: '+Curso',
    });
    const sensitive = await prisma.user.findMany({
      select: { cpf: true, institutionalEmail: true, studentNumber: true },
    });
    const guids = (await prisma.academicVerification.findMany()).map((item) => item.reportGuid);
    const descriptions = (await prisma.incident.findMany()).map((item) => item.description);
    for (const type of ['users', 'rides', 'verifications', 'incidents']) {
      const response = await panel.get(`/admin/reports/${type}/export?days=30`);
      assert.equal(response.status, 200, type);
      assert.match(response.headers['content-type'], /text\/csv/);
      assert.match(response.headers['content-disposition'], /attachment/);
      const text = response.text;
      for (const user of sensitive) {
        assert.ok(!text.includes(user.cpf), `${type}: CPF`);
        assert.ok(!text.includes(user.institutionalEmail), `${type}: e-mail`);
        if (user.studentNumber) assert.ok(!text.includes(user.studentNumber), `${type}: matrícula`);
      }
      for (const guid of guids) assert.ok(!text.includes(guid), `${type}: GUID`);
      for (const description of descriptions)
        assert.ok(!text.includes(description), `${type}: relato`);
      assert.equal(
        await prisma.auditLog.count({
          where: { action: 'ADMIN_REPORT_EXPORTED', entityId: type, actorUserId: mainAdmin.id },
        }),
        1,
      );
    }
    const users = await panel.get('/admin/reports/users/export?days=30');
    assert.ok(
      users.text.includes(`"'=HYPERLINK(""http://evil.test"")"`) ||
        users.text.includes(`'=HYPERLINK`),
    );
    assert.ok(!users.text.includes(`;=HYPERLINK`), 'fórmula neutralizada');
    assert.ok(users.text.includes(`;'+Curso;`) && formula.id);
    assert.equal((await panel.get('/admin/reports/cpfs/export')).status, 400);
    assert.ok(
      /valor_anunciado_por_pessoa_nao_e_pagamento/.test(
        (await panel.get('/admin/reports/rides/export?days=30')).text,
      ),
    );
  });

  await it('auditoria pública do painel não expõe checkpoints internos de autenticação', async () => {
    assert.ok(await prisma.auditLog.count({ where: { entityType: { in: ['AuthAttemptLimit', 'AuthCodeClaim'] } } }));
    const response = await panel.get('/admin/audit-logs?limit=100');
    assert.equal(response.status, 200);
    assert.ok(response.body.every((entry) => !['AuthAttemptLimit', 'AuthCodeClaim'].includes(entry.entityType)));
    assert.equal((await panel.get('/admin/audit-logs?entityType=AuthAttemptLimit')).body.length, 0);
  });

  await app.close();
  // A mesma guarda localhost/_test usada antes do TRUNCATE inicial protege o cleanup.
  await prisma.$executeRawUnsafe('TRUNCATE users, roles, locations, audit_logs RESTART IDENTITY CASCADE');
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
