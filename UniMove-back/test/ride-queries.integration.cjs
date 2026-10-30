// Executar após npm run build. Todos os cadastros são revertidos no PostgreSQL.
require('dotenv/config');
const assert = require('node:assert/strict');
const { randomUUID, randomInt } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { JwtService } = require('@nestjs/jwt');
const request = require('supertest');
const sharp = require('sharp');
const licensePhoto = () => sharp({ create: { width: 300, height: 180, channels: 3, background: '#eeeeee' } }).png().toBuffer();
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

async function verifyAchievements(http, tx, subjectId, authorization, otherDriverId, otherVehicleId, originId, destinationId) {
  const read = async () => (await http.get('/api/v1/users/me/achievements').set('Authorization', authorization).expect(200)).body;
  const achievement = (result, id) => result.items.find((item) => item.id === id);
  const initial = await read();
  assert.equal(initial.total, 8);
  assert.equal(initial.unlockedCount, 1);
  assert.equal(achievement(initial, 'complete-profile').unlocked, true);
  await http.get('/api/v1/users/me/achievements').expect(401);

  const people = [otherDriverId, ...Array.from({ length: 4 }, () => randomUUID())];
  const outsider = randomUUID();
  await tx.user.createMany({ data: [...people.slice(1), outsider].map((id) => ({ id, fullName: 'Participante de teste', cpf: randomCpf(), institutionalEmail: id + '@ucb.edu.br', passwordHash: 'fixture' })) });
  const vehicle = await tx.vehicle.create({ data: { ownerId: subjectId, brand: 'Teste', model: 'Teste', color: 'Prata', plate: randomUUID(), year: 2026, passengerCapacity: 2 } });
  const route = (driverId, vehicleId) => ({ driverId, vehicleId, originLocationId: originId, destinationLocationId: destinationId, departureTime: '12:00', availableSeats: 2, active: false });
  const myRoute = await tx.routeTemplate.create({ data: route(subjectId, vehicle.id) });
  const otherRoute = await tx.routeTemplate.create({ data: route(otherDriverId, otherVehicleId) });
  let serial = 0;
  const makeTrip = (driverId, status, passengers) => ({ id: randomUUID(), driverId, status, passengers, departureAt: new Date(Date.UTC(2020, 0, 1, 12, serial++)) });
  async function seed(trips) {
    await tx.ride.createMany({ data: trips.map((trip) => ({ id: trip.id, driverId: trip.driverId, routeTemplateId: trip.driverId === subjectId ? myRoute.id : otherRoute.id, vehicleId: trip.driverId === subjectId ? vehicle.id : otherVehicleId, originLocationId: originId, destinationLocationId: destinationId, departureAt: trip.departureAt, totalSeats: 2, availableSeats: 0, status: trip.status, completedAt: trip.status === 'COMPLETED' ? new Date(trip.departureAt.getTime() + 3600000) : null })) });
    const bookings = trips.flatMap((trip) => trip.passengers.map((passenger) => ({ id: randomUUID(), trip, ...passenger })));
    if (!bookings.length) return;
    await tx.rideRequest.createMany({ data: bookings.map((booking) => ({ id: booking.id, rideId: booking.trip.id, passengerId: booking.userId, seatsRequested: booking.seats ?? 1, status: 'ACCEPTED', expiresAt: booking.trip.departureAt })) });
    await tx.rideReservation.createMany({ data: bookings.map((booking) => ({ rideId: booking.trip.id, passengerId: booking.userId, requestId: booking.id, status: booking.status, seats: booking.seats ?? 1 })) });
  }
  const excluded = [
    makeTrip(subjectId, 'COMPLETED', []),
    makeTrip(subjectId, 'COMPLETED', [{ userId: people[0], status: 'CANCELLED' }]),
    makeTrip(subjectId, 'COMPLETED', [{ userId: people[0], status: 'NO_SHOW' }]),
    makeTrip(subjectId, 'CANCELLED', [{ userId: people[0], status: 'CONFIRMED' }]),
    makeTrip(subjectId, 'OPEN', [{ userId: people[0], status: 'CONFIRMED' }]),
    makeTrip(otherDriverId, 'COMPLETED', [{ userId: subjectId, status: 'NO_SHOW' }, { userId: outsider, status: 'COMPLETED' }]),
  ];
  await seed(excluded);
  assert.equal((await read()).unlockedCount, 1);

  const driven = Array.from({ length: 10 }, (_, index) => makeTrip(subjectId, 'COMPLETED', [{ userId: people[index % people.length], status: index % 2 ? 'COMPLETED' : 'CONFIRMED' }]));
  // Reserva duplicada não aumenta número de viagens, pessoas ou avaliações.
  driven[0].passengers.push({ ...driven[0].passengers[0] });
  await seed(driven);
  const driverResult = await read();
  assert.equal(achievement(driverResult, 'partner-driver').unlocked, true);
  assert.equal(achievement(driverResult, 'partner-driver').progress.current, 10);
  assert.equal(achievement(driverResult, 'campus-connections').progress.current, 5);
  assert.equal(achievement(driverResult, 'frequent-passenger').unlocked, false);

  const received = Array.from({ length: 40 }, () => makeTrip(otherDriverId, 'COMPLETED', [{ userId: subjectId, status: 'COMPLETED', seats: 2 }]));
  await seed(received);
  const bothRoles = await read();
  assert.equal(achievement(bothRoles, 'frequent-passenger').progress.current, 40);
  assert.equal(achievement(bothRoles, 'community-in-motion').progress.current, 50);
  assert.equal(achievement(bothRoles, 'community-in-motion').unlocked, true);
  assert.equal(bothRoles.unlockedCount, 7);

  const ratings = driven.slice(0, 9).map((trip) => ({ id: randomUUID(), rideId: trip.id, reviewerId: trip.passengers[0].userId, reviewedUserId: subjectId, score: 5 }));
  await tx.rating.createMany({ data: [...ratings,
    { rideId: excluded[3].id, reviewerId: people[0], reviewedUserId: subjectId, score: 5 },
    { rideId: driven[0].id, reviewerId: outsider, reviewedUserId: subjectId, score: 5 },
  ] });
  assert.equal(achievement(await read(), 'good-company').progress.current, 9);
  assert.equal(achievement(await read(), 'good-company').unlocked, false);
  const tenth = await tx.rating.create({ data: { rideId: driven[9].id, reviewerId: driven[9].passengers[0].userId, reviewedUserId: subjectId, score: 2 } });
  assert.equal(achievement(await read(), 'good-company').unlocked, false);
  await tx.rating.update({ where: { id: tenth.id }, data: { score: 3 } });
  const all = await read();
  assert.equal(achievement(all, 'good-company').unlocked, true);
  assert.equal(all.unlockedCount, 8);
  assert.equal((await read()).unlockedCount, 8);
  console.log('PASS: oito conquistas reais, viagens únicas, pessoas distintas, exclusões e mínimo de avaliações com média 4,8.');
}

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
    driverLicense: tx.driverLicense,
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
    const incomplete = await http.get('/api/v1/users/me').set('Authorization', authorization).expect(200);
    assert.equal(incomplete.body.profileCompletedAt, null);
    const blocked = await http.get('/api/v1/rides').set('Authorization', authorization).expect(403);
    assert.equal(blocked.body.code, 'PROFILE_INCOMPLETE');
    const profilePolicy = await http.get('/api/v1/users/me/profile-policy').set('Authorization', authorization).expect(200);
    assert.equal(profilePolicy.body.tags.min, 3);
    const profileData = { course: 'Engenharia de Software', semester: 3, bio: 'Gosto de compartilhar caronas.', tags: ['Pontual', 'Música ambiente', 'Aceita pets'] };
    for (const invalid of [{ course: '  ' }, { semester: 0 }, { bio: ' ' }, { tags: ['Pontual', 'Pets'] }, { tags: ['Pontual', 'pontual', 'Pets'] }, { tags: null }]) {
      await http.patch('/api/v1/users/me/profile').set('Authorization', authorization).send({ ...profileData, ...invalid }).expect(400);
    }
    const completed = await http.patch('/api/v1/users/me/profile').set('Authorization', authorization).send(profileData).expect(200);
    assert.ok(completed.body.profileCompletedAt);
    const reloadedProfile = await http.get('/api/v1/users/me').set('Authorization', authorization).expect(200);
    assert.equal(reloadedProfile.body.course, profileData.course);
    assert.deepEqual(reloadedProfile.body.tags, profileData.tags);
    await http.patch('/api/v1/users/me/profile').set('Authorization', authorization)
      .send({ ...profileData, tags: ['Pontual', 'Pets'] }).expect(400);
    const editedProfile = await http.patch('/api/v1/users/me/profile').set('Authorization', authorization)
      .send({ ...profileData, course: 'Sistemas de Informação', semester: 4, bio: 'Perfil editado e persistido.' }).expect(200);
    const editedReloaded = await http.get('/api/v1/users/me').set('Authorization', authorization).expect(200);
    assert.equal(editedReloaded.body.course, editedProfile.body.course);
    assert.equal(editedReloaded.body.semester, 4);
    assert.equal(editedReloaded.body.bio, 'Perfil editado e persistido.');
    console.log('PASS: perfil obrigatório, mínimo de três tags distintas, persistência e bloqueio pelo backend.');
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
    // Passageiro cadastra carro na própria conta e publica sem refazer o login.
    const account = await tx.user.findUniqueOrThrow({ where: { id: driverId } });
    const login = await http.post('/api/v1/auth/login')
      .send({ email: account.institutionalEmail, password: 'Senha123!' }).expect(200);
    const passengerAuthorization = 'Bearer ' + login.body.accessToken;
    const initialProfile = await http.get('/api/v1/users/me')
      .set('Authorization', passengerAuthorization).expect(200);
    assert.deepEqual(initialProfile.body.roles.map((item) => item.role.name), ['PASSENGER']);
    const vehiclePolicy = await http.get('/api/v1/vehicles/registration-policy')
      .set('Authorization', passengerAuthorization).expect(200);
    assert.equal(vehiclePolicy.body.minYear, 1990);
    assert.equal(vehiclePolicy.body.maxPassengerCapacity, 6);
    const registration = {
      brand: 'Chevrolet', model: 'Spin', color: 'Prata',
      plate: 'ABC' + String(randomInt(0, 10000)).padStart(4, '0'),
      year: vehiclePolicy.body.maxYear, passengerCapacity: 6,
    };
    for (const invalid of [{ year: 1989 }, { year: vehiclePolicy.body.maxYear + 1 }, { passengerCapacity: 0 }, { passengerCapacity: 7 }, { plate: 'INVALIDA' }]) {
      await http.post('/api/v1/vehicles').set('Authorization', passengerAuthorization)
        .field('data', JSON.stringify({ ...registration, ...invalid })).expect(400);
    }
    const licenseBefore = await http.get('/api/v1/vehicles/driver-license').set('Authorization', passengerAuthorization).expect(200);
    assert.equal(licenseBefore.body.uploaded, false);
    await http.get('/api/v1/vehicles/driver-license').expect(401);
    await http.post('/api/v1/vehicles').set('Authorization', passengerAuthorization)
      .field('data', JSON.stringify(registration)).expect(400);
    await http.post('/api/v1/vehicles').set('Authorization', passengerAuthorization)
      .field('data', JSON.stringify(registration)).attach('driverLicense', Buffer.from('not an image'), 'cnh.jpg').expect(400);
    await http.post('/api/v1/vehicles').set('Authorization', passengerAuthorization)
      .field('data', JSON.stringify(registration)).attach('driverLicense', Buffer.alloc(5 * 1024 * 1024 + 1), 'cnh.jpg').expect(413);
    assert.equal(await tx.driverLicense.count({ where: { userId: driverId } }), 0);
    const registered = await http.post('/api/v1/vehicles')
      .set('Authorization', passengerAuthorization).field('data', JSON.stringify(registration))
      .attach('driverLicense', await licensePhoto(), 'cnh.png').expect(201);
    const savedLicense = await tx.driverLicense.findUniqueOrThrow({ where: { userId: driverId } });
    assert.equal(savedLicense.mimeType, 'image/jpeg');
    assert.ok(savedLicense.sizeBytes > 0);
    const licenseAfter = await http.get('/api/v1/vehicles/driver-license').set('Authorization', passengerAuthorization).expect(200);
    assert.equal(licenseAfter.body.uploaded, true);
    assert.equal(licenseAfter.body.image, undefined);
    assert.equal(registered.body.ownerId, driverId);
    assert.equal(registered.body.passengerCapacity, 6);
    await http.post('/api/v1/vehicles').set('Authorization', passengerAuthorization)
      .field('data', JSON.stringify(registration)).expect(409);
    const profileAfter = await http.get('/api/v1/users/me')
      .set('Authorization', passengerAuthorization).expect(200);
    assert.equal(profileAfter.body.id, initialProfile.body.id);
    assert.deepEqual(profileAfter.body.roles.map((item) => item.role.name).sort(), ['DRIVER', 'PASSENGER']);
    const locations = await tx.location.findMany({ where: { active: true }, take: 2 });
    const newRide = {
      vehicleId: registered.body.id, originLocationId: locations[0].id,
      destinationLocationId: locations[1].id, departureAt: '2099-11-29T15:00:00Z',
      timezone: 'America/Sao_Paulo', availableSeats: 6, pricePerPersonCents: 0,
      acceptsLuggage: true, allowsMusic: false, acceptsPets: false,
    };
    await http.post('/api/v1/rides').set('Authorization', passengerAuthorization)
      .send(newRide).expect(403);
    const refreshed = await http.post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken }).expect(200);
    const driverAuthorization = 'Bearer ' + refreshed.body.accessToken;
    const published = await http.post('/api/v1/rides').set('Authorization', driverAuthorization)
      .send(newRide).expect(201);
    assert.equal(published.body.availableSeats, 6);
    const results = await http.get('/api/v1/rides').set('Authorization', driverAuthorization)
      .query({ date: '29/11/2099', time: '12:00', timezone: 'America/Sao_Paulo', limit: 100 }).expect(200);
    assert.ok(results.body.items.some((item) => item.id === published.body.id));
    const ownVehicles = await http.get('/api/v1/vehicles')
      .set('Authorization', driverAuthorization).expect(200);
    assert.ok(ownVehicles.body.some((item) => item.id === registered.body.id));
    const updated = await http.patch('/api/v1/vehicles/' + registered.body.id)
      .set('Authorization', driverAuthorization)
      .field('data', JSON.stringify({ brand: 'Citroën', model: 'C3 Aircross 1.6', color: 'Pérola', year: vehiclePolicy.body.maxYear, plate: registered.body.plate, passengerCapacity: 6 })).expect(200);
    assert.equal(updated.body.id, registered.body.id);
    assert.equal(updated.body.model, 'C3 Aircross 1.6');
    const reloaded = await http.get('/api/v1/vehicles/' + registered.body.id)
      .set('Authorization', driverAuthorization).expect(200);
    assert.equal(reloaded.body.color, 'Pérola');
    for (const invalid of [{ color: 'Azul2' }, { brand: 'Ford 🚗' }, { model: 'Modelo 1️⃣' }, { year: null }, { plate: null }]) {
      await http.patch('/api/v1/vehicles/' + registered.body.id)
        .set('Authorization', driverAuthorization).field('data', JSON.stringify(invalid)).expect(400);
    }
    await http.patch('/api/v1/vehicles/' + registered.body.id)
      .set('Authorization', driverAuthorization).field('data', JSON.stringify({ passengerCapacity: 1 })).expect(409);
    const strangerId = randomUUID();
    await tx.user.create({ data: { id: strangerId, fullName: 'Outra pessoa de teste', cpf: randomCpf(), institutionalEmail: strangerId + '@ucb.edu.br', passwordHash: 'test-fixture', ...profileData, profileCompletedAt: new Date() } });
    const strangerToken = await app.get(JwtService).signAsync(
      { sub: strangerId, roles: ['PASSENGER'], type: 'access' },
      { secret: process.env.JWT_ACCESS_SECRET },
    );
    await http.patch('/api/v1/vehicles/' + registered.body.id)
      .set('Authorization', 'Bearer ' + strangerToken).field('data', JSON.stringify({ color: 'Azul' })).expect(404);
    const strangerLicense = await http.get('/api/v1/vehicles/driver-license')
      .set('Authorization', 'Bearer ' + strangerToken).expect(200);
    assert.equal(strangerLicense.body.uploaded, false);
    await tx.driverLicense.delete({ where: { userId: driverId } });
    await http.post('/api/v1/rides').set('Authorization', driverAuthorization)
      .send(newRide).expect(400);
    await http.patch('/api/v1/vehicles/' + registered.body.id)
      .set('Authorization', driverAuthorization).field('data', JSON.stringify({ color: 'Pérola' }))
      .attach('driverLicense', await licensePhoto(), 'cnh.png').expect(200);
    assert.equal(await tx.driverLicense.count({ where: { userId: driverId } }), 1);
    await verifyAchievements(http, tx, strangerId, 'Bearer ' + strangerToken, driverId, registered.body.id, newRide.originLocationId, newRide.destinationLocationId);
    console.log('PASS: foto obrigatória, upload inválido/grande rejeitado, envio sem aprovação e documento privado substituível.');
    console.log('PASS: edição persistida, restrições da API, propriedade e capacidade de caronas existentes.');
    console.log('PASS: mesma conta passageiro/motorista, veículo de seis vagas, renovação da sessão e publicação/busca.');
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
        await tx.driverLicense.create({ data: { userId: driver.id, image: await licensePhoto(), mimeType: 'image/png', sizeBytes: (await licensePhoto()).length } });
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
        await tx.driverLicense.delete({ where: { userId: driver.id } });
        await verifyHttp(tx, driver.id, filters);
        console.log(
          'PASS: cadastro/aceite, filtros, fuso, paginação, avaliação real e próximas caronas.',
        );
        throw rollback;
      },
      { timeout: 180000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.equal(await prisma.user.count({ where: { id: createdIds.user } }), 0);
  assert.equal(await prisma.ride.count({ where: { id: createdIds.ride } }), 0);
  assert.equal(await prisma.driverLicense.count({ where: { userId: createdIds.user } }), 0);
  console.log('PASS: rollback confirmado; nenhum cadastro de teste mantido.');
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
