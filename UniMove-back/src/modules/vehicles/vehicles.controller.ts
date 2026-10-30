import {
  Body,
  BadRequestException,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DriverLicenseService } from './driver-license.service';
import { VehicleUploadPipe } from './vehicle-upload.pipe';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { PrismaService } from '../../database/prisma.service';
import { RoleName, RideStatus } from '../../generated/prisma/enums';
import { Prisma } from '../../generated/prisma/client';
import { CreateVehicleDto, UpdateVehicleDto } from './vehicle.dto';
import { DRIVER_LICENSE_MAX_BYTES, vehicleRegistrationPolicy } from './vehicle-policy';

const licenseUpload = FileInterceptor('driverLicense', {
  limits: { fileSize: DRIVER_LICENSE_MAX_BYTES, files: 1, fields: 1, fieldSize: 16384 },
});

@Controller('vehicles')
export class VehiclesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly licenses: DriverLicenseService,
  ) {}
  @Get('registration-policy') policy() {
    return vehicleRegistrationPolicy();
  }
  @Get('driver-license') async driverLicense(@CurrentUser() user: AuthUser) {
    const license = await this.prisma.driverLicense.findUnique({
      where: { userId: user.id },
      select: { updatedAt: true },
    });
    return { uploaded: !!license, updatedAt: license?.updatedAt ?? null };
  }
  @Post()
  @UseInterceptors(licenseUpload)
  async create(
    @CurrentUser() user: AuthUser,
    @Body('data', new VehicleUploadPipe(CreateVehicleDto)) payload: unknown,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const dto = payload as CreateVehicleDto;
    const document = await this.licenses.image(file);
    const plate = dto.plate.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const existing = await this.prisma.vehicle.findUnique({ where: { plate } });
    if (existing) throw new ConflictException('Placa já cadastrada.');
    return this.prisma
      .$transaction(async (tx) => {
        if (document) {
          await tx.driverLicense.upsert({
            where: { userId: user.id },
            create: { userId: user.id, ...document },
            update: document,
          });
        } else if (
          !(await tx.driverLicense.findUnique({
            where: { userId: user.id },
            select: { userId: true },
          }))
        ) {
          throw new BadRequestException('A foto da CNH é obrigatória.');
        }
        const vehicle = await tx.vehicle.create({ data: { ...dto, plate, ownerId: user.id } });
        const role = await tx.role.upsert({
          where: { name: RoleName.DRIVER },
          update: {},
          create: { name: RoleName.DRIVER },
        });
        await tx.userRole.upsert({
          where: { userId_roleId: { userId: user.id, roleId: role.id } },
          update: {},
          create: { userId: user.id, roleId: role.id },
        });
        return vehicle;
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('Placa já cadastrada.');
        }
        throw error;
      });
  }
  @Get() list(@CurrentUser() user: AuthUser) {
    return this.prisma.vehicle.findMany({
      where: { ownerId: user.id, active: true },
      orderBy: { createdAt: 'desc' },
    });
  }
  @Get(':id') async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.owned(user.id, id);
  }
  @Patch(':id')
  @UseInterceptors(licenseUpload)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body('data', new VehicleUploadPipe(UpdateVehicleDto)) payload: unknown,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const dto = payload as UpdateVehicleDto;
    const document = await this.licenses.image(file);
    return this.prisma
      .$transaction(async (tx) => {
        const vehicle = await tx.vehicle.findFirst({ where: { id, ownerId: user.id } });
        if (!vehicle) throw new NotFoundException('Veículo não encontrado.');
        if (document) {
          await tx.driverLicense.upsert({
            where: { userId: user.id },
            create: { userId: user.id, ...document },
            update: document,
          });
        } else if (
          !(await tx.driverLicense.findUnique({
            where: { userId: user.id },
            select: { userId: true },
          }))
        ) {
          throw new BadRequestException('A foto da CNH é obrigatória.');
        }
        if (
          dto.passengerCapacity !== undefined &&
          dto.passengerCapacity < vehicle.passengerCapacity
        ) {
          const [rides, routes] = await Promise.all([
            tx.ride.count({
              where: {
                vehicleId: id,
                status: { in: [RideStatus.OPEN, RideStatus.SCHEDULED, RideStatus.IN_PROGRESS] },
                totalSeats: { gt: dto.passengerCapacity },
              },
            }),
            tx.routeTemplate.count({
              where: { vehicleId: id, active: true, availableSeats: { gt: dto.passengerCapacity } },
            }),
          ]);
          if (rides || routes)
            throw new ConflictException(
              'Há caronas ou rotas ativas com mais vagas que a nova capacidade. Ajuste essas ofertas antes de reduzir as vagas do carro.',
            );
        }
        return tx.vehicle.update({ where: { id }, data: dto });
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw new ConflictException('Placa já cadastrada.');
        throw error;
      });
  }
  @Delete(':id') @HttpCode(204) async remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    await this.owned(user.id, id);
    await this.prisma.vehicle.update({ where: { id }, data: { active: false } });
  }
  private async owned(ownerId: string, id: string) {
    const item = await this.prisma.vehicle.findFirst({ where: { id, ownerId } });
    if (!item) throw new NotFoundException('Veículo não encontrado.');
    return item;
  }
}
