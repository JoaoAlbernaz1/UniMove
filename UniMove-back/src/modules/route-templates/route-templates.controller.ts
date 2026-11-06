import { MAX_PASSENGER_CAPACITY } from '../vehicles/vehicle-policy';
import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { CurrentUser, Roles } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { RequireAcademicVerification } from '../../common/decorators/profile.decorators';
import { PrismaService } from '../../database/prisma.service';
import { RoleName, Weekday } from '../../generated/prisma/enums';

class CreateRouteTemplateDto {
  @IsUUID() vehicleId!: string;
  @IsUUID() originLocationId!: string;
  @IsUUID() destinationLocationId!: string;
  @IsArray() @ArrayNotEmpty() weekdays!: Weekday[];
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) departureTime!: string;
  @IsInt() @Min(1) @Max(MAX_PASSENGER_CAPACITY) availableSeats!: number;
  @IsOptional() @IsString() timezone?: string;
}
class UpdateRouteTemplateDto {
  @IsOptional() @IsInt() @Min(1) @Max(MAX_PASSENGER_CAPACITY) availableSeats?: number;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) departureTime?: string;
}

@Controller('route-templates')
@Roles(RoleName.DRIVER)
export class RouteTemplatesController {
  constructor(private readonly prisma: PrismaService) {}
  @Post()
  @RequireAcademicVerification()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateRouteTemplateDto) {
    return this.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
    if (
      !(await tx.driverLicense.findUnique({
        where: { userId: user.id },
        select: { userId: true },
      }))
    )
      throw new BadRequestException(
        'Envie a foto da CNH na edição do carro antes de oferecer carona.',
      );
    const vehicle = await tx.vehicle.findFirst({
      where: { id: dto.vehicleId, ownerId: user.id, active: true },
    });
    if (!vehicle || dto.availableSeats > vehicle.passengerCapacity)
      throw new NotFoundException('Veículo inválido ou capacidade excedida.');
    return tx.routeTemplate.create({
      data: {
        driverId: user.id,
        vehicleId: dto.vehicleId,
        originLocationId: dto.originLocationId,
        destinationLocationId: dto.destinationLocationId,
        departureTime: dto.departureTime,
        availableSeats: dto.availableSeats,
        timezone: dto.timezone,
        weekdays: { create: [...new Set(dto.weekdays)].map((weekday) => ({ weekday })) },
      },
      include: { weekdays: true, originLocation: true, destinationLocation: true },
    });
    });
  }
  @Get() list(@CurrentUser() user: AuthUser) {
    return this.prisma.routeTemplate.findMany({
      where: { driverId: user.id, active: true },
      include: { weekdays: true, vehicle: true, originLocation: true, destinationLocation: true },
    });
  }
  @Get(':id') async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.owned(user.id, id);
  }
  @Patch(':id') async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateRouteTemplateDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
      const route = await tx.routeTemplate.findFirst({ where: { id, driverId: user.id, vehicle: { active: true } } });
      if (!route) throw new NotFoundException('Rota não encontrada ou veículo desativado.');
      return tx.routeTemplate.update({ where: { id }, data: dto });
    });
  }
  @Delete(':id') @HttpCode(204) async remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    await this.owned(user.id, id);
    await this.prisma.routeTemplate.update({ where: { id }, data: { active: false } });
  }
  private async owned(driverId: string, id: string) {
    const route = await this.prisma.routeTemplate.findFirst({
      where: { id, driverId },
      include: { weekdays: true },
    });
    if (!route) throw new NotFoundException('Rota não encontrada.');
    return route;
  }
}

@Controller('locations')
export class LocationsController {
  constructor(private readonly prisma: PrismaService) {}
  @Get() list() {
    return this.prisma.location.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  }
}
