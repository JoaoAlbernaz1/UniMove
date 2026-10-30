import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateVehicleDto, UpdateVehicleDto } from './vehicle.dto';
import { vehicleRegistrationPolicy } from './vehicle-policy';

describe('Cadastro de veículos', () => {
  const input = {
    brand: 'Chevrolet',
    model: 'Spin',
    color: 'Prata',
    plate: 'ABC1D23',
    year: 2027,
    passengerCapacity: 6,
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-29T12:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it.each([1, 6])('aceita %i vagas para passageiros', async (passengerCapacity) => {
    expect(
      await validate(plainToInstance(CreateVehicleDto, { ...input, passengerCapacity })),
    ).toHaveLength(0);
  });

  it.each([1990, 2026, 2027])('aceita o ano %i', async (year) => {
    expect(await validate(plainToInstance(CreateVehicleDto, { ...input, year }))).toHaveLength(0);
  });

  it.each([
    { year: 1989 },
    { year: 2028 },
    { year: 2026.5 },
    { year: '2027' },
    { passengerCapacity: 0 },
    { passengerCapacity: 7 },
    { passengerCapacity: 1.5 },
    { brand: '   ' },
    { model: '' },
    { color: ' ' },
    { plate: 'ABC123' },
    { plate: 'ABC!1234' },
  ])('rejeita dados inválidos: %p', async (change) => {
    expect(
      (await validate(plainToInstance(CreateVehicleDto, { ...input, ...change }))).length,
    ).toBeGreaterThan(0);
  });

  it.each(['abc-1234', ' abc1d23 '])('normaliza e aceita placa %s', async (plate) => {
    const dto = plainToInstance(CreateVehicleDto, { ...input, plate, brand: ' Chevrolet ' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.plate).toMatch(/^[A-Z0-9]{7}$/);
    expect(dto.brand).toBe('Chevrolet');
  });

  it('atualiza o limite sem reiniciar o processo ao virar o ano em Brasília', async () => {
    jest.setSystemTime(new Date('2027-01-01T02:59:59Z'));
    expect(vehicleRegistrationPolicy().maxYear).toBe(2027);
    const dto = plainToInstance(CreateVehicleDto, { ...input, year: 2028 });
    expect((await validate(dto)).length).toBeGreaterThan(0);
    jest.setSystemTime(new Date('2027-01-01T03:00:00Z'));
    expect(vehicleRegistrationPolicy().maxYear).toBe(2028);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('aplica o mesmo limite de vagas na edição', async () => {
    expect(
      await validate(plainToInstance(UpdateVehicleDto, { passengerCapacity: 6 })),
    ).toHaveLength(0);
    expect(
      (await validate(plainToInstance(UpdateVehicleDto, { passengerCapacity: 7 }))).length,
    ).toBeGreaterThan(0);
  });

  it.each([
    { brand: 'Ford 🚗' },
    { model: 'Spin 🇧🇷' },
    { model: 'Modelo 1️⃣' },
    { color: 'Azul2' },
    { color: 'Preto 🚗' },
    { year: null },
    { plate: null },
  ])('rejeita restrições também na edição: %p', async (change) => {
    expect(
      (await validate(plainToInstance(CreateVehicleDto, { ...input, ...change }))).length,
    ).toBeGreaterThan(0);
    expect((await validate(plainToInstance(UpdateVehicleDto, change))).length).toBeGreaterThan(0);
  });

  it('permite edição completa, nomes com números e cores acentuadas', async () => {
    expect(
      await validate(
        plainToInstance(UpdateVehicleDto, {
          ...input,
          model: 'C3 Aircross 1.6',
          color: 'Pérola',
          plate: 'def-1234',
        }),
      ),
    ).toHaveLength(0);
  });
});
