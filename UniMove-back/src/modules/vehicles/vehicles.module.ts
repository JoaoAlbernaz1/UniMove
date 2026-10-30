import { Module } from '@nestjs/common';
import { VehiclesController } from './vehicles.controller';
import { DriverLicenseService } from './driver-license.service';
@Module({ controllers: [VehiclesController], providers: [DriverLicenseService] })
export class VehiclesModule {}
