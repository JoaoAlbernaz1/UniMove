import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { RideQueriesService } from './ride-queries.service';
import { SearchRidesDto } from './search-rides.dto';

@Controller('rides')
export class RideQueriesController {
  constructor(private readonly queries: RideQueriesService) {}
  @Get() search(@Query() query: SearchRidesDto) {
    return this.queries.search(query);
  }
  @Get('upcoming') upcoming(@CurrentUser() user: AuthUser) {
    return this.queries.upcoming(user.id);
  }
}
