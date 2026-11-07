import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AdminRoute } from '../../common/decorators/admin.decorators';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import {
  AdminAuditQueryDto,
  AdminIncidentsQueryDto,
  AdminRidesQueryDto,
  AdminUsersQueryDto,
  PeriodQueryDto,
  REPORT_TYPES,
  type ReportType,
  UpdateIncidentDto,
  UpdateUserStatusDto,
} from './admin.dto';
import { AdminInsightsService } from './admin-insights.service';
import { AdminOperationsService } from './admin-operations.service';
import { AdminUsersService } from './admin-users.service';

// O corpo das listas continua sendo um array, como já era nestas rotas. Paginação
// e contagens vão em cabeçalhos.
function withTotal<T>(response: Response, result: { items: T[]; total: number }) {
  response.setHeader('X-Total-Count', String(result.total));
  return result.items;
}

@AdminRoute()
@Controller('admin')
export class AdminController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly operations: AdminOperationsService,
    private readonly insights: AdminInsightsService,
  ) {}

  @Get('dashboard/summary') summary() {
    return this.insights.summary();
  }

  @Get('dashboard/series') series(@Query() query: PeriodQueryDto) {
    return this.insights.series(query.days);
  }

  @Get('users') async listUsers(
    @Query() query: AdminUsersQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return withTotal(response, await this.users.list(query));
  }

  @Get('users/:id') user(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.users.detail(id);
  }

  @Get('users/:id/impact') userImpact(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.users.impact(id);
  }

  @Patch('users/:id/status') userStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.users.changeStatus(actor, id, dto);
  }

  @Get('rides') async rides(
    @Query() query: AdminRidesQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { statusCounts, ...result } = await this.operations.rides(query);
    response.setHeader('X-Status-Counts', JSON.stringify(statusCounts));
    return withTotal(response, result);
  }

  @Get('rides/:id') ride(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.operations.ride(id);
  }

  @Get('incidents') async incidents(
    @Query() query: AdminIncidentsQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { statusCounts, ...result } = await this.operations.incidents(query);
    response.setHeader('X-Status-Counts', JSON.stringify(statusCounts));
    return withTotal(response, result);
  }

  @Get('incidents/:id') incident(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.operations.incident(id);
  }

  @Patch('incidents/:id') updateIncident(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateIncidentDto,
  ) {
    return this.operations.updateIncident(actor, id, dto);
  }

  @Get('audit-logs') async auditLogs(
    @Query() query: AdminAuditQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return withTotal(response, await this.operations.auditLogs(query));
  }

  @Get('reports/summary') report(@Query() query: PeriodQueryDto) {
    return this.insights.report(query.days);
  }

  @Get('reports/:type/export') async exportReport(
    @CurrentUser() actor: AuthUser,
    @Param('type') type: string,
    @Query() query: PeriodQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!REPORT_TYPES.includes(type as ReportType))
      throw new BadRequestException('Relatório desconhecido.');
    const { csv, filename, truncated } = await this.insights.exportReport(
      actor.id,
      type as ReportType,
      query.days,
    );
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.setHeader('X-Report-Truncated', String(truncated));
    return csv;
  }
}
