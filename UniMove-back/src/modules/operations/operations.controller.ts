import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { CurrentUser, Roles } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../database/prisma.service';
import {
  IncidentStatus,
  IncidentType,
  NotificationType,
  RoleName,
  UserStatus,
} from '../../generated/prisma/enums';
import { NotificationService } from '../notifications/notifications.service';
import { ApiBearerAuth } from '@nestjs/swagger';

class IncidentDto {
  @IsUUID() rideId!: string;
  @IsOptional() @IsUUID() reportedUserId?: string;
  @IsEnum(IncidentType) type!: IncidentType;
  @IsString() description!: string;
}
class UpdateIncidentDto {
  @IsEnum(IncidentStatus) status!: IncidentStatus;
}
class UpdateUserStatusDto {
  @IsEnum(UserStatus) status!: UserStatus;
}

@Controller('incidents')
export class IncidentsController {
  constructor(private readonly prisma: PrismaService) {}
  @Post() create(@CurrentUser() user: AuthUser, @Body() dto: IncidentDto) {
    return this.prisma.incident.create({ data: { ...dto, reportedById: user.id } });
  }
}

@Controller('history')
export class HistoryController {
  constructor(private readonly prisma: PrismaService) {}
  @Get() list(@CurrentUser() user: AuthUser, @Query() page: PaginationDto) {
    return this.prisma.ride.findMany({
      where: { OR: [{ driverId: user.id }, { reservations: { some: { passengerId: user.id } } }] },
      include: {
        originLocation: true,
        destinationLocation: true,
        driver: { select: { id: true, fullName: true } },
        reservations: { include: { passenger: { select: { id: true, fullName: true } } } },
        ratings: { where: { reviewerId: user.id } },
      },
      orderBy: { departureAt: 'desc' },
      skip: (page.page - 1) * page.limit,
      take: page.limit,
    });
  }
}
@ApiBearerAuth()
@Controller('admin')
@Roles(RoleName.ADMIN)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}
  @Get('users') users(@Query() page: PaginationDto) {
    return this.prisma.user.findMany({
      select: { id: true, fullName: true, institutionalEmail: true, status: true, createdAt: true },
      skip: (page.page - 1) * page.limit,
      take: page.limit,
    });
  }
  @Get('users/:id') user(@Param('id') id: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id },
      omit: { passwordHash: true, cpf: true },
    });
  }
  @Patch('users/:id/status') async userStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    const user = await this.prisma.user.update({ where: { id }, data: dto });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: `ADMIN_USER_${dto.status}`,
        entityType: 'User',
        entityId: id,
      },
    });
    return user;
  }
  @Get('rides') rides(@Query() page: PaginationDto) {
    return this.prisma.ride.findMany({
      include: {
        driver: { select: { id: true, fullName: true } },
        originLocation: true,
        destinationLocation: true,
      },
      skip: (page.page - 1) * page.limit,
      take: page.limit,
    });
  }
  @Get('rides/:id') ride(@Param('id') id: string) {
    return this.prisma.ride.findUniqueOrThrow({
      where: { id },
      include: { requests: true, reservations: true, cancellations: true, incidents: true },
    });
  }
  @Get('incidents') incidents(@Query() page: PaginationDto) {
    return this.prisma.incident.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page.page - 1) * page.limit,
      take: page.limit,
    });
  }
  @Get('incidents/:id') incident(@Param('id') id: string) {
    return this.prisma.incident.findUniqueOrThrow({ where: { id } });
  }
  @Patch('incidents/:id') async incidentStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateIncidentDto,
  ) {
    const incident = await this.prisma.incident.update({
      where: { id },
      data: {
        status: dto.status,
        resolvedAt: (
          [IncidentStatus.RESOLVED, IncidentStatus.DISMISSED] as IncidentStatus[]
        ).includes(dto.status)
          ? new Date()
          : null,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: 'INCIDENT_UPDATED',
        entityType: 'Incident',
        entityId: id,
        metadata: { status: dto.status },
      },
    });
    await this.notifications.create({
      userId: incident.reportedById,
      type: NotificationType.INCIDENT_UPDATED,
      title: 'Incidente atualizado',
      message: 'O status do incidente reportado foi atualizado.',
      resourceType: 'INCIDENT',
      resourceId: incident.id,
      metadata: { status: dto.status },
    });
    return incident;
  }
  @Get('audit-logs') audit(@Query() page: PaginationDto) {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page.page - 1) * page.limit,
      take: page.limit,
    });
  }
}
