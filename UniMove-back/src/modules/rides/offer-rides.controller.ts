import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUser, Roles } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { RoleName } from '../../generated/prisma/enums';
import { CreateRideDto } from './create-ride.dto';
import { OfferRidesService } from './offer-rides.service';

@Controller('rides')
export class OfferRidesController {
  constructor(private readonly offers: OfferRidesService) {}

  @Post()
  @Roles(RoleName.DRIVER)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRideDto) {
    return this.offers.create(user.id, dto);
  }
}
