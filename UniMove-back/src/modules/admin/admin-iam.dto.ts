import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsStrongPassword,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import {
  AdminInviteStatus,
  AdminPermission,
  AdminRecoveryStatus,
} from '../../generated/prisma/enums';
import { PASSWORD_ERROR, passwordOptions } from '../auth/registration-policy';
import { ADMIN_PERMISSIONS } from './admin-permissions';

const trimmed = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

/** Senha administrativa segue a mesma política do cadastro de estudante. */
const StrongPassword = () => IsStrongPassword(passwordOptions, { message: PASSWORD_ERROR });

/**
 * Reautenticação exigida nas operações que mudam quem tem acesso. Vai no corpo
 * da requisição para a tela pedir senha e código no mesmo passo.
 */
export class ReauthDto {
  @IsString() @MaxLength(200) password!: string;
  @trimmed() @IsString() @Length(6, 6) twoFactorCode!: string;
}

export class AdminInvitesQueryDto extends PaginationDto {
  @IsOptional() @IsEnum(AdminInviteStatus) status?: AdminInviteStatus;
  @IsOptional() @trimmed() @IsString() @MaxLength(100) q?: string;
}

export class CreateAdminInviteDto {
  @IsEmail() email!: string;
  @trimmed() @IsString() @MinLength(3) @MaxLength(120) fullName!: string;
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(ADMIN_PERMISSIONS.length)
  @IsEnum(AdminPermission, { each: true })
  permissions!: AdminPermission[];
}

export class AdminTokenDto {
  @trimmed() @IsString() @Length(20, 200) token!: string;
}

export class AcceptInvitePasswordDto extends AdminTokenDto {
  /** Conta nova: CPF e senha. Conta existente: apenas `currentPassword`. */
  @IsOptional() @IsString() @Length(11, 14) cpf?: string;
  @IsOptional() @IsString() @StrongPassword() password?: string;
  @IsOptional() @IsString() @MaxLength(200) currentPassword?: string;
}

export class AcceptInviteTwoFactorDto extends AdminTokenDto {
  @trimmed() @IsString() @Length(6, 6) code!: string;
}

export class UpdateAdminPermissionsDto extends ReauthDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(ADMIN_PERMISSIONS.length)
  @IsEnum(AdminPermission, { each: true })
  permissions!: AdminPermission[];
  @trimmed() @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

export class RevokeAdminAccessDto extends ReauthDto {
  @trimmed() @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

export class RequestPasswordResetDto {
  @IsEmail() email!: string;
}

export class ConfirmPasswordResetDto extends AdminTokenDto {
  @IsString() @StrongPassword() password!: string;
}

export class RequestMfaRecoveryDto {
  @IsEmail() email!: string;
  @IsString() @MaxLength(200) password!: string;
  @trimmed() @IsString() @MinLength(10) @MaxLength(500) reason!: string;
}

export class AdminRecoveriesQueryDto extends PaginationDto {
  @IsOptional() @IsEnum(AdminRecoveryStatus) status?: AdminRecoveryStatus;
}

export class ReviewMfaRecoveryDto extends ReauthDto {
  @IsBoolean() approve!: boolean;
  @IsOptional() @trimmed() @IsString() @MaxLength(500) note?: string;
}

export class StartMfaRecoveryDto extends AdminTokenDto {
  @IsString() @MaxLength(200) password!: string;
}

export class ConfirmMfaRecoveryDto extends AdminTokenDto {
  @trimmed() @IsString() @Length(6, 6) code!: string;
}

export class AdminAccountsQueryDto extends PaginationDto {
  @IsOptional() @trimmed() @IsString() @MaxLength(100) q?: string;
}
