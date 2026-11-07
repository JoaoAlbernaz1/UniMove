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

/** Agrupamento da auditoria. 'security' é o que a tela de segurança mostra. */
export const AUDIT_GROUPS = ['security'] as const;
export type AuditGroup = (typeof AUDIT_GROUPS)[number];

/**
 * Ações que a trilha de segurança reúne: entrar, segundo fator, convite,
 * permissão, senha, recuperação e sessão. Suspensão de estudante e moderação
 * ficam de fora: são operação, não acesso.
 */
export const SECURITY_AUDIT_ACTIONS = [
  'ADMIN_LOGIN',
  'ADMIN_LOGIN_FAILED',
  'ADMIN_LOGOUT',
  'ADMIN_ACCESS_DENIED',
  'ADMIN_2FA_FAILED',
  'ADMIN_2FA_ENROLLED',
  'ADMIN_2FA_ENROLLMENT_STARTED',
  'ADMIN_2FA_REPLACEMENT_STARTED',
  'ADMIN_2FA_REPLACED',
  'ADMIN_2FA_RESET_BY_OPERATOR',
  'ADMIN_RECOVERY_CODE_USED',
  'ADMIN_RECOVERY_CODES_REGENERATED',
  'ADMIN_REAUTH_FAILED',
  'ADMIN_INVITE_CREATED',
  'ADMIN_INVITE_EMAIL_FAILED',
  'ADMIN_INVITE_EMAIL_CONFIRMED',
  'ADMIN_INVITE_PASSWORD_SET',
  'ADMIN_INVITE_ACCEPTED',
  'ADMIN_INVITE_REVOKED',
  'ADMIN_PERMISSIONS_CHANGED',
  'ADMIN_ACCESS_REVOKED',
  'ADMIN_PASSWORD_CHANGED',
  'ADMIN_PASSWORD_RESET_REQUESTED',
  'ADMIN_PASSWORD_RESET_COMPLETED',
  'ADMIN_MFA_RECOVERY_REQUESTED',
  'ADMIN_MFA_RECOVERY_APPROVED',
  'ADMIN_MFA_RECOVERY_REJECTED',
  'ADMIN_MFA_RECOVERY_STARTED',
  'ADMIN_MFA_RECOVERY_COMPLETED',
  'ADMIN_SESSION_REVOKED',
  'ADMIN_SESSIONS_REVOKED_OTHERS',
  'ADMIN_SESSIONS_REVOKED_BY_MANAGER',
  'ADMIN_SESSION_REUSE_DETECTED',
] as const;

export class AdminAuditQueryDto extends PaginationDto {
  @IsOptional() @trimmed() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn([...AUDIT_GROUPS]) group?: AuditGroup;
  @IsOptional() @trimmed() @IsString() @MaxLength(60) action?: string;
  @IsOptional() @trimmed() @IsString() @MaxLength(60) entityType?: string;
  @IsOptional() @IsUUID() actorUserId?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}

export class PeriodQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @IsIn([...REPORT_PERIODS]) days: number = 30;
}
