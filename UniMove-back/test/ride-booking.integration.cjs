// All fixtures live in a transaction that is always rolled back. No external notifications.
require('dotenv/config');
const assert = require('node:assert/strict');
const { randomUUID, randomInt } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { JwtService } = require('@nestjs/jwt');
const request = require('supertest');
const { AppModule } = require('../dist/src/app.module.js');
const { PrismaService } = require('../dist/src/database/prisma.service.js');
const {
  NotificationService,
} = require('../dist/src/modules/notifications/notifications.service.js');
const { HttpExceptionFilter } = require('../dist/src/common/filters/http-exception.filter.js');
const { PrismaClient } = require('../dist/src/generated/prisma/client.js');
const { PrismaPg } = require('@prisma/adapter-pg');
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const rollback = new Error('ROLLBACK_BOOKING_FIXTURES');
const createdIds = [];

async function check(tx) {
  const connection = new Proxy(
    {},
    {
      get: (_, name) => {
        if (name === '$transaction')
          return (callback) =>
            typeof callback === 'function' ? callback(tx) : Promise.all(callback);
        if (['onModuleInit', 'onModuleDestroy', '$connect', '$disconnect', 'then'].includes(name))
          return undefined;
        const value = tx[name];
        return typeof value === 'function' ? value.bind(tx) : value;
      },
    },
  );
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(connection)
    .overrideProvider(NotificationService)
    .useValue({
      create: (data, client = tx) => client.notification.create({ data }),
      createMany: (data, client = tx) => client.notification.createMany({ data }),
    })
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
    const users = [];
    for (let i = 0; i < 4; i++) {
      const id = randomUUID();
      createdIds.push(id);
      users.push(
        await tx.user.create({
          data: {
            id,
            fullName: `Booking test ${i}`,
            cpf: String(randomInt(10000000000, 99999999999)),
            institutionalEmail: `${id}@example.test`,
            passwordHash: 'integration-only',
            profileCompletedAt: new Date(),
          },
        }),
      );
      await tx.academicVerification.create({
        data: { userId: id, reportGuid: randomUUID(), status: 'APPROVED' },
      });
      for (const name of i === 0 ? ['DRIVER', 'PASSENGER'] : ['PASSENGER']) {
        const role = await tx.role.upsert({ where: { name }, update: {}, create: { name } });
        await tx.userRole.create({ data: { userId: id, roleId: role.id } });
      }
    }
    const [driver, passenger, other, outsider] = users;
    const tokens = await Promise.all(
      users.map((user, i) =>
        app
          .get(JwtService)
          .signAsync(
            {
              sub: user.id,
              roles: i === 0 ? ['DRIVER', 'PASSENGER'] : ['PASSENGER'],
              type: 'access',
            },
            { secret: process.env.JWT_ACCESS_SECRET },
          ),
      ),
    );
    const [driverAuth, passengerAuth, otherAuth, outsiderAuth] = tokens.map(
      (token) => `Bearer ${token}`,
    );
    const location = await tx.location.create({
      data: { name: `Booking-${randomUUID()}`, latitude: -15.8, longitude: -48.0 },
    });
    const destination = await tx.location.create({
      data: { name: `Destination-${randomUUID()}`, latitude: -15.9, longitude: -48.1 },
    });
    const vehicle = await tx.vehicle.create({
      data: {
        ownerId: driver.id,
        brand: 'Test',
        model: 'Booking',
        color: 'Branco',
        plate: 'TST' + randomInt(1000, 9999),
        year: 2020,
        passengerCapacity: 2,
      },
    });
    const route = await tx.routeTemplate.create({
      data: {
        driverId: driver.id,
        vehicleId: vehicle.id,
        originLocationId: location.id,
        destinationLocationId: destination.id,
        departureTime: '12:00',
        availableSeats: 2,
        active: false,
      },
    });
    const departure = new Date(Date.now() + 86400000);
    const makeRide = (seconds, availableSeats = 1) =>
      tx.ride.create({
        data: {
          routeTemplateId: route.id,
          driverId: driver.id,
          vehicleId: vehicle.id,
          originLocationId: location.id,
          destinationLocationId: destination.id,
          departureAt: new Date(departure.getTime() + seconds * 1000),
          totalSeats: availableSeats,
          availableSeats,
        },
      });
    const ride = await makeRide(0);
    // Different ride, same departure minute (a different template avoids unique conflict).
    const route2 = await tx.routeTemplate.create({
      data: {
        driverId: driver.id,
        vehicleId: vehicle.id,
        originLocationId: location.id,
        destinationLocationId: destination.id,
        departureTime: '12:00',
        availableSeats: 2,
        active: false,
      },
    });
    const sameTime = await tx.ride.create({
      data: {
        routeTemplateId: route2.id,
        driverId: driver.id,
        vehicleId: vehicle.id,
        originLocationId: location.id,
        destinationLocationId: destination.id,
        departureAt: departure,
        totalSeats: 2,
        availableSeats: 2,
      },
    });
    const details = (auth, id = ride.id) =>
      http.get(`/api/v1/rides/${id}/details`).set('Authorization', auth).expect(200);
    const send = (auth, id = ride.id, seats = 1) =>
      http.post(`/api/v1/rides/${id}/requests`).set('Authorization', auth).send({ seats });
    const search = (auth = passengerAuth) =>
      http
        .get('/api/v1/rides')
        .query({ origin: location.name })
        .set('Authorization', auth)
        .expect(200);
    await http.get(`/api/v1/rides/${ride.id}/details`).expect(401);
    assert.equal((await details(passengerAuth)).body.canRequest, true);
    assert.equal((await details(driverAuth)).body.canRequest, false);
    await send(driverAuth).expect(409);
    for (const seats of [0, 2, 3, 4, 5, 6, 7, 1.5, '1']) await send(passengerAuth, ride.id, seats).expect(400);
    await tx.academicVerification.update({ where: { userId: outsider.id }, data: { status: 'REJECTED' } });
    await send(outsiderAuth).expect(403);
    await tx.academicVerification.update({ where: { userId: outsider.id }, data: { status: 'APPROVED' } });
    const first = (await send(passengerAuth).expect(201)).body;
    const indicators = async (auth) => (await http.get('/api/v1/users/me/indicators').set('Authorization', auth).expect(200)).body;
    assert.equal((await indicators(driverAuth)).hasPendingRideRequests, true);
    assert.equal((await indicators(passengerAuth)).hasPendingRideRequests, false);
    assert.equal(first.seatsRequested, 1);
    assert.equal(first.passengerId, passenger.id);
    assert.equal((await details(passengerAuth)).body.request.status, 'PENDING');
    assert.equal((await details(otherAuth)).body.availableSeats, 0);
    assert.equal((await details(otherAuth)).body.request, null);
    const waitingSearch = (await search()).body;
    assert.equal(waitingSearch.hasPendingRequest, true);
    assert.equal(waitingSearch.items.find((item) => item.id === ride.id).requestStatus, 'PENDING');
    assert.equal(waitingSearch.items.find((item) => item.id === ride.id).availableSeats, 0);
    assert.ok(waitingSearch.items.every((item) => item.canRequest === false));
    assert.equal((await search(otherAuth)).body.items.some((item) => item.id === ride.id), false);
    const differentTime = await makeRide(7200);
    await send(passengerAuth, differentTime.id).expect(409);
    assert.equal((await details(passengerAuth, differentTime.id)).body.canRequest, false);
    assert.equal((await details(passengerAuth, differentTime.id)).body.hasPendingRequest, true);
    await send(otherAuth).expect(409);
    await send(passengerAuth).expect(409);
    await send(passengerAuth, sameTime.id).expect(409);
    const mine = await http
      .get('/api/v1/rides/requests/mine')
      .set('Authorization', passengerAuth)
      .expect(200);
    assert.equal(mine.body[0].id, first.id);
    const inbox = await http
      .get('/api/v1/driver/ride-requests?status=PENDING')
      .set('Authorization', driverAuth)
      .expect(200);
    assert.equal(inbox.body[0].id, first.id);
    assert.equal(inbox.body[0].ride.originLocation.name, location.name);
    await http
      .post(`/api/v1/ride-requests/${first.id}/accept`)
      .set('Authorization', outsiderAuth)
      .expect(403);
    await http
      .post(`/api/v1/ride-requests/${first.id}/accept`)
      .set('Authorization', driverAuth)
      .expect(201);
    assert.equal((await details(passengerAuth)).body.request.reservation.status, 'CONFIRMED');
    assert.equal((await tx.ride.findUniqueOrThrow({ where: { id: ride.id } })).availableSeats, 0);
    await send(passengerAuth, sameTime.id).expect(409);
    await http
      .post(`/api/v1/ride-requests/${first.id}/accept`)
      .set('Authorization', driverAuth)
      .expect(201);
    assert.equal(await tx.rideReservation.count({ where: { requestId: first.id } }), 1);
    assert.equal(
      await tx.messageConversation.count({ where: { rideId: ride.id, passengerId: passenger.id } }),
      1,
    );
    assert.equal((await indicators(driverAuth)).hasPendingRideRequests, false);
    const conversation = await tx.messageConversation.findFirstOrThrow({ where: { rideId: ride.id, passengerId: passenger.id } });
    const messageTime = new Date();
    const firstMessage = await tx.chatMessage.create({ data: { conversationId: conversation.id, senderId: driver.id, content: 'Message indicator fixture', createdAt: messageTime } });
    const secondMessage = await tx.chatMessage.create({ data: { conversationId: conversation.id, senderId: driver.id, content: 'Newer unread fixture', createdAt: new Date(messageTime.getTime() + 1000) } });
    assert.equal((await indicators(passengerAuth)).hasUnreadMessages, true);
    assert.equal((await indicators(driverAuth)).hasUnreadMessages, false);
    assert.equal((await indicators(outsiderAuth)).hasUnreadMessages, false);
    const markRead = (auth, id) => http.post(`/api/v1/messages/conversations/${conversation.id}/read`).set('Authorization', auth).send({ throughMessageId: id });
    await markRead(outsiderAuth, firstMessage.id).expect(404);
    await markRead(driverAuth, secondMessage.id).expect(201);
    assert.equal((await indicators(passengerAuth)).hasUnreadMessages, true);
    await markRead(passengerAuth, firstMessage.id).expect(201);
    assert.ok((await tx.chatMessage.findUniqueOrThrow({ where: { id: firstMessage.id } })).readAt);
    assert.equal((await tx.chatMessage.findUniqueOrThrow({ where: { id: secondMessage.id } })).readAt, null);
    assert.equal((await indicators(passengerAuth)).hasUnreadMessages, true);
    await markRead(passengerAuth, secondMessage.id).expect(201);
    assert.equal((await indicators(passengerAuth)).hasUnreadMessages, false);
    console.log('PASS: pending and unread indicators, isolation, recipient-only reading and newer messages stay unread.');
    const expiring = await makeRide(3600);
    const pending = (await send(otherAuth, expiring.id).expect(201)).body;
    await tx.rideRequest.update({
      where: { id: pending.id },
      data: { expiresAt: new Date(0) },
    });
    assert.equal((await details(otherAuth, expiring.id)).body.request.status, 'EXPIRED');
    assert.equal((await search(otherAuth)).body.hasPendingRequest, false);
    assert.equal((await search(otherAuth)).body.items.find((item) => item.id === differentTime.id).canRequest, true);
    assert.equal((await details(outsiderAuth, expiring.id)).body.availableSeats, 1);
    await http
      .post(`/api/v1/ride-requests/${pending.id}/accept`)
      .set('Authorization', driverAuth)
      .expect(409);
    const replacement = (await send(outsiderAuth, expiring.id).expect(201)).body;
    await http
      .post(`/api/v1/ride-requests/${replacement.id}/reject`)
      .set('Authorization', driverAuth)
      .expect(201);
    assert.equal((await details(outsiderAuth, expiring.id)).body.request.status, 'REJECTED');
    assert.equal((await details(otherAuth, expiring.id)).body.availableSeats, 1);
    assert.equal(
      (await search()).body.items.find((item) => item.id === expiring.id).availableSeats,
      1,
    );
    console.log(
      'PASS: HTTP booking, seat holds, same-time conflicts, accept/reject/expiry, ownership, chat and search availability.',
    );
    await http.post('/api/v1/vehicles/leave-driver').set('Authorization', driverAuth).expect(409);
    assert.equal((await tx.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).active, true);
    // Finish the fixture offers before leaving; no real user records are touched.
    await tx.ride.updateMany({ where: { driverId: driver.id }, data: { status: 'CANCELLED' } });
    await tx.routeTemplate.update({ where: { id: route.id }, data: { active: true } });
    const reservationsBefore = await tx.rideReservation.count({ where: { rideId: ride.id } });
    await http.post('/api/v1/vehicles/leave-driver').set('Authorization', driverAuth).expect(200);
    assert.equal((await tx.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).active, false);
    assert.equal((await tx.routeTemplate.findUniqueOrThrow({ where: { id: route.id } })).active, false);
    assert.equal(await tx.rideReservation.count({ where: { rideId: ride.id } }), reservationsBefore);
    await http.get('/api/v1/driver/ride-requests').set('Authorization', driverAuth).expect(403);
    const afterLeaving = (await http.get('/api/v1/users/me').set('Authorization', driverAuth).expect(200)).body;
    assert.deepEqual(afterLeaving.roles.map(({ role }) => role.name), ['PASSENGER']);
    assert.equal((await http.get('/api/v1/vehicles').set('Authorization', driverAuth).expect(200)).body.length, 0);
    // Repeating the operation is harmless, and the owner can register the same plate again.
    await http.post('/api/v1/vehicles/leave-driver').set('Authorization', driverAuth).expect(200);
    const photo = await require('sharp')({ create: { width: 30, height: 30, channels: 3, background: '#eeeeee' } }).png().toBuffer();
    const rejoined = await http.post('/api/v1/vehicles').set('Authorization', driverAuth)
      .field('data', JSON.stringify({ brand: vehicle.brand, model: vehicle.model, color: vehicle.color, plate: vehicle.plate, year: vehicle.year, passengerCapacity: vehicle.passengerCapacity }))
      .attach('driverLicense', photo, 'cnh.png').expect(201);
    assert.equal(rejoined.body.id, vehicle.id);
    assert.equal(rejoined.body.active, true);
    await http.get('/api/v1/driver/ride-requests').set('Authorization', driverAuth).expect(200);
    console.log('PASS: leaving driver, active-ride protection, soft deletion, history, immediate role revocation and re-registration.');
  } finally {
    await app.close();
  }
}

(async () => {
  try {
    await prisma.$transaction(
      async (tx) => {
        await check(tx);
        throw rollback;
      },
      { timeout: 180000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.equal(await prisma.user.count({ where: { id: { in: createdIds } } }), 0);
  console.log('PASS: rollback confirmed; no test users or bookings persisted.');
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
