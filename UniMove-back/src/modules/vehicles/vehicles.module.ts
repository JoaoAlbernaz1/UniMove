import { Module } from '@nestjs/common';
import { VehiclesController } from './vehicles.controller';
import { DriverLicenseService } from './driver-license.service';
import { DriverMembershipService } from './driver-membership.service';
import { NotificationsModule } from '../notifications/notifications.module';
@Module({
  imports: [NotificationsModule],
  controllers: [VehiclesController],
  providers: [DriverLicenseService, DriverMembershipService],
})
export class VehiclesModule {}
