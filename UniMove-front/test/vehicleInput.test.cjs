const { test } = require('node:test');
const assert = require('node:assert/strict');
const { vehicleYearInput, vehiclePlateInput, vehicleColorInput, vehicleNameInput } = require('../src/vehicleInput.ts');

test('ano mantém apenas quatro dígitos e placa aceita colagem com hífen', () => {
  assert.equal(vehicleYearInput('20a27/2028', 4), '2027');
  assert.equal(vehiclePlateInput('abc-1234', 7), 'ABC1234');
  assert.equal(vehiclePlateInput('abc1d23extra', 7), 'ABC1D23');
});

test('cor preserva acentos; marca e modelo preservam números e removem emojis compostos', () => {
  assert.equal(vehicleColorInput('Pérola 123🚗'), 'Pérola ');
  assert.equal(vehicleNameInput('C3 Aircross 1.6 🚗🇧🇷1️⃣👨‍👩‍👧'), 'C3 Aircross 1.6 ');
});
