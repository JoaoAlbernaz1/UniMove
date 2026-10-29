const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  formatRideDate,
  formatRideTime,
  formatRidePrice,
  rideDeparture,
  initialOfferRide,
  offerRideInput,
} = require('../src/offerRide.ts');

const valid = {
  ...initialOfferRide,
  originLocationId: 'origin',
  destinationLocationId: 'destination',
  vehicleId: 'vehicle',
  date: '01/12/2099',
  time: '20:30',
  availableSeats: 3,
  price: '12,50',
};

test('formata data, horário e reais durante a digitação', () => {
  assert.equal(formatRideDate('01122099'), '01/12/2099');
  assert.equal(formatRideTime('2030'), '20:30');
  assert.equal(formatRidePrice('1250'), '12,50');
  assert.equal(formatRidePrice(''), '');
  assert.equal(formatRidePrice('0'), '0,00');
});

test('recusa datas inexistentes e respeita anos bissextos', () => {
  assert.equal(rideDeparture('31/02/2099', '20:30'), null);
  assert.equal(rideDeparture('29/02/2099', '20:30'), null);
  assert.ok(rideDeparture('29/02/2096', '20:30'));
  assert.equal(rideDeparture('01/12/2099', '24:00'), null);
});

test('converte data local para UTC e envia centavos e preferências sem perder dados', () => {
  const result = offerRideInput({
    ...valid,
    additionalInfo: '  Portão 1  ',
    acceptsPets: true,
  });
  assert.equal(result.departureAt, new Date(2099, 11, 1, 20, 30).toISOString());
  assert.equal(result.pricePerPersonCents, 1250);
  assert.equal(result.additionalInfo, 'Portão 1');
  assert.equal(result.acceptsPets, true);
  assert.equal(result.allowsMusic, false);
  assert.equal(result.acceptsLuggage, true);
  assert.equal(
    result.timezone,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
});
