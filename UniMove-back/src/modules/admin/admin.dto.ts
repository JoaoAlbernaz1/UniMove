import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import {
  AcademicVerificationStatus,
  IncidentStatus,
  IncidentType,
  RideStatus,
  RoleName,
  UserStatus,
} from '../../generated/prisma/enums';

const trimmed = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export const REPORT_PERIODS = [7, 30, 90] as const;
export const REPORT_TYPES = ['users', 'rides', 'verifications', 'incidents'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export class AdminUsersQueryDto extends PaginationDto {
  @IsOptional() @trimmed() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @IsOptional() @IsEnum(RoleName) role?: RoleName;
  @IsOptional()
  @IsIn([...Object.values(AcademicVerificationStatus), 'NONE'])
  verification?: AcademicVerificationStatus | 'NONE';
  @IsOptional() @IsIn(['newest', 'oldest']) sort?: 'newest' | 'oldest';
}

export class UpdateUserStatusDto {
  // DEACTIVATED fica de fora: é o resultado da exclusão e anonimização da conta,
  // não um estado que se atribui por aqui.
  @IsIn([UserStatus.ACTIVE, UserStatus.SUSPENDED, UserStatus.BLOCKED])
  status!: UserStatus;
  @trimmed() @IsString() @MinLength(5) @MaxLength(500) reason!: string;
  @IsOptional() @IsBoolean() confirmImpact?: boolean;
}

export class AdminRidesQueryDto extends PaginationDto {
  @IsOptional() @trimmed() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsEnum(RideStatus) status?: RideStatus;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}

export class AdminIncidentsQueryDto extends PaginationDto {
  @IsOptional() @IsEnum(IncidentStatus) status?: IncidentStatus;
  @IsOptional() @IsEnum(IncidentType) type?: IncidentType;
}

export class UpdateIncidentDto {
  @IsEnum(IncidentStatus) status!: IncidentStatus;
  @IsOptional() @trimmed() @IsString() @MaxLength(1000) note?: string;
}

export class AdminAuditQueryDto extends PaginationDto {
  @IsOptional() @trimmed() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @trimmed() @IsString() @MaxLength(60) entityType?: string;
  @IsOptional() @IsUUID() actorUserId?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}

export class PeriodQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @IsIn([...REPORT_PERIODS]) days: number = 30;
}
