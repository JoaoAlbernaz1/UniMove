import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { RequireAcademicVerification } from '../../common/decorators/profile.decorators';
import { RideQueriesService } from './ride-queries.service';
import { SearchRidesDto } from './search-rides.dto';

@Controller('rides')
export class RideQueriesController {
  constructor(private readonly queries: RideQueriesService) {}
  @Get()
  @RequireAcademicVerification()
  search(@Query() query: SearchRidesDto) {
    return this.queries.search(query);
  }
  @Get('upcoming') upcoming(@CurrentUser() user: AuthUser) {
    return this.queries.upcoming(user.id);
  }
  @Get(':id/details')
  @RequireAcademicVerification()
  details(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.queries.details(id, user.id);
  }
}
