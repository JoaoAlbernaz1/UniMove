import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { PrismaService } from '../../database/prisma.service';
import { ROLES_KEY } from '../../common/decorators/auth.decorators';
import { RoleName } from '../../generated/prisma/enums';
import { CreateRideDto } from './create-ride.dto';
import { OfferRidesController } from './offer-rides.controller';
import { OfferRidesService } from './offer-rides.service';

describe('Publicação de carona avulsa', () => {
  const vehicleFind = jest.fn();
  const locationCount = jest.fn();
  const routeCreate = jest.fn();
  const rideCreate = jest.fn();
  const tx = {
    vehicle: { findFirst: vehicleFind },
    location: { count: locationCount },
    routeTemplate: { create: routeCreate },
    ride: { create: rideCreate },
  };
  const transaction = jest.fn((callback: (client: typeof tx) => unknown) =>
    Promise.resolve(callback(tx)),
  );
  const service = new OfferRidesService({ $transaction: transaction } as unknown as PrismaService);
  const input: CreateRideDto = {
    vehicleId: '11111111-1111-4111-8111-111111111111',
    originLocationId: '22222222-2222-4222-8222-222222222222',
    destinationLocationId: '33333333-3333-4333-8333-333333333333',
    departureAt: '2099-12-01T23:30:00.000Z',
    timezone: 'America/Sao_Paulo',
    availableSeats: 3,
    pricePerPersonCents: 1250,
    additionalInfo: '  Portão principal  ',
    acceptsLuggage: true,
    allowsMusic: false,
    acceptsPets: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    vehicleFind.mockResolvedValue({ passengerCapacity: 4 });
    locationCount.mockResolvedValue(2);
    routeCreate.mockResolvedValue({ id: 'route-id' });
    rideCreate.mockResolvedValue({ id: 'ride-id' });
  });

  it('restringe a publicação ao perfil motorista', () => {
    const handler = Object.getOwnPropertyDescriptor(
      OfferRidesController.prototype,
      'create',
    )?.value;
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([RoleName.DRIVER]);
  });

  it('publica com preço em centavos, preferências e horário UTC em uma transação', async () => {
    await expect(service.create('driver-id', input)).resolves.toEqual({ id: 'ride-id' });
    expect(vehicleFind).toHaveBeenCalledWith({
      where: { id: input.vehicleId, ownerId: 'driver-id', active: true },
    });
    expect(routeCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        active: false,
        departureTime: '20:30',
        timezone: input.timezone,
      }),
    });
    expect(rideCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        driverId: 'driver-id',
        routeTemplateId: 'route-id',
        totalSeats: 3,
        availableSeats: 3,
        departureAt: new Date(input.departureAt),
        pricePerPersonCents: 1250,
        additionalInfo: 'Portão principal',
        acceptsLuggage: true,
        allowsMusic: false,
        acceptsPets: true,
      }),
      include: expect.any(Object),
    });
  });

  it('recusa veículo inexistente, inativo ou de outro usuário', async () => {
    vehicleFind.mockResolvedValue(null);
    await expect(service.create('driver-id', input)).rejects.toBeInstanceOf(NotFoundException);
    expect(routeCreate).not.toHaveBeenCalled();
  });

  it('recusa vagas acima da capacidade', async () => {
    vehicleFind.mockResolvedValue({ passengerCapacity: 2 });
    await expect(service.create('driver-id', input)).rejects.toBeInstanceOf(BadRequestException);
    expect(rideCreate).not.toHaveBeenCalled();
  });

  it('recusa locais inexistentes ou inativos', async () => {
    locationCount.mockResolvedValue(1);
    await expect(service.create('driver-id', input)).rejects.toBeInstanceOf(BadRequestException);
    expect(routeCreate).not.toHaveBeenCalled();
  });

  it.each(['2020-01-01T12:00:00Z', 'data-inválida'])(
    'recusa partida passada ou inválida: %s',
    async (departureAt) => {
      await expect(service.create('driver-id', { ...input, departureAt })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it('recusa origem igual ao destino', async () => {
    await expect(
      service.create('driver-id', { ...input, destinationLocationId: input.originLocationId }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('propaga falhas de persistência sem confirmar a publicação', async () => {
    rideCreate.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.create('driver-id', input)).rejects.toThrow('database unavailable');
  });

  it('aceita um contrato válido', async () => {
    expect(await validate(plainToInstance(CreateRideDto, input))).toHaveLength(0);
  });

  it.each([
    { availableSeats: 0 },
    { availableSeats: 5 },
    { availableSeats: 1.5 },
    { pricePerPersonCents: -1 },
    { pricePerPersonCents: 1.5 },
    { pricePerPersonCents: 1000001 },
    { departureAt: '2099-12-01T20:30:00' },
    { timezone: 'invalid' },
    { additionalInfo: 'x'.repeat(1001) },
    { acceptsPets: 'true' },
    { vehicleId: 'invalid' },
  ])('valida o contrato antes de acessar o banco: %p', async (change) => {
    const errors = await validate(plainToInstance(CreateRideDto, { ...input, ...change }));
    expect(errors.length).toBeGreaterThan(0);
  });
});
