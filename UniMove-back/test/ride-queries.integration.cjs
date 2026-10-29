// Executar após npm run build. Todos os cadastros são revertidos no PostgreSQL.
require('dotenv/config');
const assert = require('node:assert/strict');
const { randomUUID, randomInt } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { JwtService } = require('@nestjs/jwt');
const request = require('supertest');
const { AppModule } = require('../dist/src/app.module.js');
const { PrismaService } = require('../dist/src/database/prisma.service.js');
const { HttpExceptionFilter } = require('../dist/src/common/filters/http-exception.filter.js');
const { PrismaClient } = require('../dist/src/generated/prisma/client.js');
const { PrismaPg } = require('@prisma/adapter-pg');
const { OfferRidesService } = require('../dist/src/modules/rides/offer-rides.service.js');
const { RideQueriesService } = require('../dist/src/modules/rides/ride-queries.service.js');
const { SearchRidesDto } = require('../dist/src/modules/rides/search-rides.dto.js');
const { AuthService } = require('../dist/src/modules/auth/auth.service.js');
const {
  TERMS_VERSION,
  PRIVACY_POLICY_VERSION,
} = require('../dist/src/modules/auth/registration-policy.js');

function randomCpf() {
  let digits = String(randomInt(100000000, 999999999));
  for (const length of [9, 10]) {
    const sum = [...digits].reduce(
      (total, digit, i) => total + Number(digit) * (length + 1 - i),
      0,
    );
    const rest = (sum * 10) % 11;
    digits += rest === 10 ? '0' : String(rest);
  }
  return digits;
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const rollback = new Error('ROLLBACK_TEST_DATA');

async function verifyHttp(tx, driverId, filters) {
  const connection = {
    user: tx.user,
    role: tx.role,
    userRole: tx.userRole,
    ride: tx.ride,
    rating: tx.rating,
    routeTemplate: tx.routeTemplate,
    location: tx.location,
    vehicle: tx.vehicle,
    refreshSession: tx.refreshSession,
    auditLog: tx.auditLog,
    $queryRaw: tx.$queryRaw.bind(tx),
    $transaction: (callback) =>
      typeof callback === 'function' ? callback(tx) : Promise.all(callback),
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(connection)
    .compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  try {
    await app.init();
    const http = request(app.getHttpServer());
    const policy = await http.get('/api/v1/auth/registration-policy').expect(200);
    assert.equal(policy.body.termsVersion, TERMS_VERSION);
    await http.get('/api/v1/rides').expect(401);
    const token = await app
      .get(JwtService)
      .signAsync(
        { sub: driverId, roles: ['DRIVER'], type: 'access' },
        { secret: process.env.JWT_ACCESS_SECRET },
      );
    const authorization = 'Bearer ' + token;
    const page = await http
      .get('/api/v1/rides')
      .set('Authorization', authorization)
      .query({ ...filters, limit: 2 })
      .expect(200);
    assert.equal(page.body.total, 23);
    assert.equal(page.body.items.length, 2);
    assert.equal(page.body.items[0].driver.ratingAverage, 3);
    await http
      .get('/api/v1/rides')
      .set('Authorization', authorization)
      .query({ date: '31/02/2099' })
      .expect(400);
    await http
      .get('/api/v1/rides')
      .set('Authorization', authorization)
      .query({ timezone: 'invalid' })
      .expect(400);
    await http
      .get('/api/v1/rides')
      .set('Authorization', authorization)
      .query({ limit: 101 })
      .expect(400);
    const upcoming = await http
      .get('/api/v1/rides/upcoming')
      .set('Authorization', authorization)
      .expect(200);
    assert.equal(upcoming.body.length, 3);
    const valid = {
      fullName: 'Pessoa de teste',
      cpf: '52998224725',
      institutionalEmail: 'teste@ucb.edu.br',
      password: 'Senha123!',
      passwordConfirmation: 'Senha123!',
      acceptedTerms: true,
      termsVersion: TERMS_VERSION,
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    };
    for (const invalid of [
      { fullName: '   ' },
      { password: 'abcdefgh', passwordConfirmation: 'abcdefgh' },
      { acceptedTerms: false },
      { termsVersion: 'old' },
      { passwordConfirmation: 'Outra123!' },
    ]) {
      await http
        .post('/api/v1/auth/register')
        .send({ ...valid, ...invalid })
        .expect(400);
    }
    await http
      .patch('/api/v1/users/me')
      .set('Authorization', authorization)
      .send({ fullName: '   ' })
      .expect(400);
    await http
      .patch('/api/v1/users/me/password')
      .set('Authorization', authorization)
      .send({ currentPassword: 'Senha123!', newPassword: 'abcdefgh' })
      .expect(400);
    console.log(
      'PASS: contratos HTTP, autenticação, filtros e rejeição das regras inválidas pela API.',
    );
  } finally {
    await app.close();
  }
}

async function run() {
  const createdIds = {};
  try {
    await prisma.$transaction(
      async (tx) => {
        const suffix = randomUUID();
        const auth = new AuthService(
          { user: tx.user, $transaction: (callback) => callback(tx) },
          {},
          {
            get: (key) => (key === 'auth.institutionalDomains' ? ['ucb.edu.br'] : undefined),
          },
        );
        const policy = auth.registrationPolicy();
        assert.equal(policy.termsVersion, TERMS_VERSION);
        assert.equal(policy.termsOfUse.title, 'Termos de Uso');
        const driver = await auth.register({
          fullName: '  Teste de integração  ',
          cpf: randomCpf(),
          institutionalEmail: suffix + '@ucb.edu.br',
          password: 'Senha123!',
          passwordConfirmation: 'Senha123!',
          acceptedTerms: true,
          termsVersion: TERMS_VERSION,
          privacyPolicyVersion: PRIVACY_POLICY_VERSION,
        });
        createdIds.user = driver.id;
        const savedUser = await tx.user.findUniqueOrThrow({ where: { id: driver.id } });
        assert.equal(savedUser.fullName, 'Teste de integração');
        assert.ok(savedUser.termsAcceptedAt instanceof Date);
        assert.equal(savedUser.termsVersion, TERMS_VERSION);
        assert.equal(savedUser.privacyPolicyVersion, PRIVACY_POLICY_VERSION);

        const vehicle = await tx.vehicle.create({
          data: {
            ownerId: driver.id,
            brand: 'Teste',
            model: 'Teste',
            color: 'Teste',
            plate: suffix,
            year: 2026,
            passengerCapacity: 3,
          },
        });
        const origin = await tx.location.create({ data: { name: 'Águas teste ' + suffix } });
        const destination = await tx.location.create({ data: { name: 'Campus teste ' + suffix } });
        const offers = new OfferRidesService({ $transaction: (callback) => callback(tx) });
        const input = {
          vehicleId: vehicle.id,
          originLocationId: origin.id,
          destinationLocationId: destination.id,
          timezone: 'America/Sao_Paulo',
          availableSeats: 2,
          pricePerPersonCents: 1250,
          acceptsLuggage: true,
          allowsMusic: false,
          acceptsPets: true,
        };
        const early = await offers.create(driver.id, {
          ...input,
          departureAt: '2099-12-01T11:00:00Z',
        });
        const late = await offers.create(driver.id, {
          ...input,
          departureAt: '2099-12-02T01:30:00Z',
        });
        const tomorrow = await offers.create(driver.id, {
          ...input,
          departureAt: '2099-12-02T11:00:00Z',
        });
        createdIds.ride = late.id;
        await tx.ride.createMany({
          data: Array.from({ length: 20 }, (_, minute) => ({
            routeTemplateId: early.routeTemplateId,
            driverId: driver.id,
            vehicleId: vehicle.id,
            originLocationId: origin.id,
            destinationLocationId: destination.id,
            departureAt: new Date(Date.UTC(2099, 11, 3, 11, minute)),
            totalSeats: 2,
            availableSeats: 2,
          })),
        });

        const reviewer = await tx.user.create({
          data: {
            fullName: 'Passageiro teste',
            cpf: randomUUID(),
            institutionalEmail: randomUUID() + '@example.invalid',
            passwordHash: 'unused',
          },
        });
        const queries = new RideQueriesService(tx);
        const filters = { origin: 'AGUAS TESTE ' + suffix, destination: 'campus teste ' + suffix };
        const query = (values) => Object.assign(new SearchRidesDto(), filters, values);
        const unrated = await queries.search(query({ limit: 1 }));
        assert.equal(unrated.items[0].driver.ratingAverage, null);
        assert.equal(unrated.items[0].driver.ratingCount, 0);
        const completed = await offers.create(driver.id, {
          ...input,
          departureAt: '2099-12-04T11:00:00Z',
        });
        await tx.ride.update({
          where: { id: completed.id },
          data: { status: 'COMPLETED', departureAt: new Date('2020-01-01T11:00:00Z') },
        });
        await tx.rating.create({
          data: {
            rideId: completed.id,
            reviewerId: reviewer.id,
            reviewedUserId: driver.id,
            score: 4,
          },
        });
        const secondReviewer = await tx.user.create({
          data: {
            fullName: 'Outro passageiro teste',
            cpf: randomUUID(),
            institutionalEmail: randomUUID() + '@example.invalid',
            passwordHash: 'unused',
          },
        });
        await tx.rating.create({
          data: {
            rideId: completed.id,
            reviewerId: secondReviewer.id,
            reviewedUserId: driver.id,
            score: 2,
          },
        });
        const firstPage = await queries.search(query({ page: 1, limit: 2 }));
        const secondPage = await queries.search(query({ page: 2, limit: 2 }));
        assert.equal(firstPage.total, 23);
        assert.deepEqual(
          firstPage.items.map((ride) => ride.id),
          [early.id, late.id],
        );
        assert.equal(secondPage.items[0].id, tomorrow.id);
        assert.equal(firstPage.items[0].driver.ratingAverage, 3);
        assert.equal(firstPage.items[0].driver.ratingCount, 2);
        assert.equal(firstPage.items[0].pricePerPersonCents, 1250);

        const day = await queries.search(query({ date: '01/12/2099' }));
        assert.deepEqual(
          day.items.map((ride) => ride.id),
          [early.id, late.id],
        );
        const time = await queries.search(query({ time: '08:00' }));
        assert.equal(time.total, 3);
        const exact = await queries.search(query({ date: '01/12/2099', time: '22:30' }));
        assert.equal(exact.items[0].id, late.id);
        const utc = await queries.search(
          query({ date: '02/12/2099', time: '01:30', timezone: 'UTC' }),
        );
        assert.equal(utc.items[0].id, late.id);
        await assert.rejects(queries.search(query({ date: '31/02/2099' })), /data válida/);
        const literal = await queries.search(query({ origin: "%' OR 1=1 --" }));
        assert.equal(literal.total, 0);

        const upcoming = await queries.upcoming(driver.id);
        assert.deepEqual(
          upcoming.map((ride) => ride.id),
          [early.id, late.id, tomorrow.id],
        );
        assert.equal(upcoming[0].participationRole, 'DRIVER');
        assert.deepEqual(await queries.upcoming(randomUUID()), []);
        const request = await tx.rideRequest.create({
          data: {
            rideId: late.id,
            passengerId: reviewer.id,
            seatsRequested: 1,
            status: 'ACCEPTED',
            expiresAt: new Date('2099-12-01T00:00:00Z'),
          },
        });
        await tx.rideReservation.create({
          data: { rideId: late.id, passengerId: reviewer.id, requestId: request.id, seats: 1 },
        });
        const passengerUpcoming = await queries.upcoming(reviewer.id);
        assert.equal(passengerUpcoming.length, 1);
        assert.equal(passengerUpcoming[0].participationRole, 'PASSENGER');
        assert.equal(passengerUpcoming[0].reservedSeats, 1);
        await verifyHttp(tx, driver.id, filters);
        console.log(
          'PASS: cadastro/aceite, filtros, fuso, paginação, avaliação real e próximas caronas.',
        );
        throw rollback;
      },
      { timeout: 90000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.equal(await prisma.user.count({ where: { id: createdIds.user } }), 0);
  assert.equal(await prisma.ride.count({ where: { id: createdIds.ride } }), 0);
  console.log('PASS: rollback confirmado; nenhum cadastro de teste mantido.');
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
