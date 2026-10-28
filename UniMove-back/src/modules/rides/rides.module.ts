import { Module } from '@nestjs/common';
import { ReservationsController, RidesController } from './rides.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { OfferRidesController } from './offer-rides.controller';
import { OfferRidesService } from './offer-rides.service';
import { RideQueriesController } from './ride-queries.controller';
import { RideQueriesService } from './ride-queries.service';
@Module({
  imports: [NotificationsModule],
  controllers: [
    RidesController,
    ReservationsController,
    OfferRidesController,
    RideQueriesController,
  ],
  providers: [OfferRidesService, RideQueriesService],
})
export class RidesModule {}
