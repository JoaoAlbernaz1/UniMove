import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateRideDto } from './create-ride.dto';

@Injectable()
export class OfferRidesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(driverId: string, dto: CreateRideDto) {
    const departureAt = new Date(dto.departureAt);
    if (!Number.isFinite(departureAt.getTime()) || departureAt.getTime() <= Date.now())
      throw new BadRequestException('Escolha uma data e um horário futuros.');
    if (dto.originLocationId === dto.destinationLocationId)
      throw new BadRequestException('A origem e o destino devem ser diferentes.');

    return this.prisma.$transaction(async (tx) => {
      if (
        !(await tx.driverLicense.findUnique({
          where: { userId: driverId },
          select: { userId: true },
        }))
      )
        throw new BadRequestException(
          'Envie a foto da CNH na edição do carro antes de oferecer carona.',
        );
      const vehicle = await tx.vehicle.findFirst({
        where: { id: dto.vehicleId, ownerId: driverId, active: true },
      });
      if (!vehicle) throw new NotFoundException('Selecione um veículo ativo da sua conta.');
      if (dto.availableSeats > vehicle.passengerCapacity)
        throw new BadRequestException('As vagas excedem a capacidade do veículo.');
      const locations = await tx.location.count({
        where: { id: { in: [dto.originLocationId, dto.destinationLocationId] }, active: true },
      });
      if (locations !== 2)
        throw new BadRequestException('Selecione locais válidos para o trajeto.');

      const departureTime = new Intl.DateTimeFormat('en-GB', {
        timeZone: dto.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(departureAt);

      // A carona avulsa mantém a relação existente sem gerar uma rota recorrente.
      const route = await tx.routeTemplate.create({
        data: {
          driverId,
          vehicleId: dto.vehicleId,
          originLocationId: dto.originLocationId,
          destinationLocationId: dto.destinationLocationId,
          departureTime,
          timezone: dto.timezone,
          availableSeats: dto.availableSeats,
          active: false,
        },
      });
      return tx.ride.create({
        data: {
          driverId,
          routeTemplateId: route.id,
          vehicleId: dto.vehicleId,
          originLocationId: dto.originLocationId,
          destinationLocationId: dto.destinationLocationId,
          departureAt,
          totalSeats: dto.availableSeats,
          availableSeats: dto.availableSeats,
          pricePerPersonCents: dto.pricePerPersonCents,
          additionalInfo: dto.additionalInfo?.trim() || null,
          acceptsLuggage: dto.acceptsLuggage,
          allowsMusic: dto.allowsMusic,
          acceptsPets: dto.acceptsPets,
        },
        include: { originLocation: true, destinationLocation: true, vehicle: true },
      });
    });
  }
}
