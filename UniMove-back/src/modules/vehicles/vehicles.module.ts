import { Module } from '@nestjs/common';
import { VehiclesController } from './vehicles.controller';
import { DriverLicenseService } from './driver-license.service';
import { DriverMembershipService } from './driver-membership.service';
@Module({ controllers: [VehiclesController], providers: [DriverLicenseService, DriverMembershipService] })
export class VehiclesModule {}
