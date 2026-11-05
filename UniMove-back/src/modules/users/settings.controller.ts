import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsIn, IsOptional, IsString, Max, Min } from 'class-validator';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import QRCode from 'qrcode';
import { generateSecret, generateURI, verify } from 'otplib';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { AllowIncompleteProfile } from '../../common/decorators/profile.decorators';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { PrismaService } from '../../database/prisma.service';
import { ProfileVisibility, RoleName } from '../../generated/prisma/enums';
import {
  decryptTwoFactorSecret,
  encryptTwoFactorSecret,
  isTwoFactorKeyConfigured,
} from '../auth/two-factor-crypto';

class NotificationPreferencesDto {
  @IsOptional() @Transform(({ value }) => value) @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() rideRequests?: boolean;
  @IsOptional() @IsBoolean() confirmations?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(60) reminderMinutes?: number;
  @IsOptional() @IsBoolean() chatMessages?: boolean;
  @IsOptional() @IsBoolean() payments?: boolean;
  @IsOptional() @IsBoolean() safety?: boolean;
  @IsOptional() @IsBoolean() promotions?: boolean;
  @IsOptional() @IsBoolean() push?: boolean;
  @IsOptional() @IsBoolean() email?: boolean;
  @IsOptional() @IsBoolean() sms?: boolean;
  @IsOptional() @IsBoolean() doNotDisturb?: boolean;
  @IsOptional() @IsString() @IsIn(['22:00', '23:00']) quietStart?: string;
  @IsOptional() @IsString() @IsIn(['07:00', '08:00']) quietEnd?: string;
}

class PrivacyPreferencesDto {
  @IsOptional() @IsEnum(ProfileVisibility) profileVisibility?: ProfileVisibility;
  @IsOptional() @IsBoolean() courseSemester?: boolean;
  @IsOptional() @IsBoolean() ratings?: boolean;
  @IsOptional() @IsBoolean() phoneSharing?: boolean;
  @IsOptional() @IsBoolean() realTimeLocation?: boolean;
  @IsOptional() @IsBoolean() frequentLocations?: boolean;
}

class PushDeviceDto {
  @IsString() token!: string;
  @IsString() platform!: string;
}

class PhoneDto {
  @IsString() phone!: string;
}

class EnableTwoFactorDto {
  @IsString() code!: string;
}

class DisableTwoFactorDto {
  @IsString() password!: string;
  @IsOptional() @IsString() code?: string;
}

@ApiBearerAuth()
@Controller('users/me')
export class SettingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('notification-preferences')
  async notificationPreferences(@CurrentUser() user: AuthUser) {
    return this.prisma.notificationPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    });
  }

  @Patch('notification-preferences')
  async updateNotificationPreferences(
    @CurrentUser() user: AuthUser,
    @Body() dto: NotificationPreferencesDto,
  ) {
    return this.prisma.notificationPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...dto },
      update: dto,
    });
  }

  @Get('privacy-preferences')
  async privacyPreferences(@CurrentUser() user: AuthUser) {
    return this.prisma.privacyPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    });
  }

  @Patch('privacy-preferences')
  async updatePrivacyPreferences(
    @CurrentUser() user: AuthUser,
    @Body() dto: PrivacyPreferencesDto,
  ) {
    return this.prisma.privacyPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...dto, consentUpdatedAt: new Date() },
      update: { ...dto, consentUpdatedAt: new Date() },
    });
  }

  @Get('blocked-users')
  blockedUsers(@CurrentUser() user: AuthUser) {
    return this.prisma.userBlock.findMany({
      where: { blockerId: user.id },
      select: {
        blockedId: true,
        createdAt: true,
        blocked: {
          select: { id: true, fullName: true, profilePhoto: { select: { updatedAt: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('blocked-users/:blockedId')
  async blockUser(@CurrentUser() user: AuthUser, @Param('blockedId') blockedId: string) {
    if (blockedId === user.id)
      throw new BadRequestException('Você não pode bloquear sua própria conta.');
    await this.prisma.user.findUniqueOrThrow({ where: { id: blockedId }, select: { id: true } });
    await this.prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId: user.id, blockedId } },
      create: { blockerId: user.id, blockedId },
      update: {},
    });
    return { blocked: true };
  }

  @Delete('blocked-users/:blockedId')
  async unblockUser(@CurrentUser() user: AuthUser, @Param('blockedId') blockedId: string) {
    await this.prisma.userBlock.deleteMany({ where: { blockerId: user.id, blockedId } });
    return { blocked: false };
  }

  @Post('push-devices')
  registerPushDevice(@CurrentUser() user: AuthUser, @Body() dto: PushDeviceDto) {
    return this.prisma.pushDevice.upsert({
      where: { token: dto.token },
      create: { userId: user.id, token: dto.token, platform: dto.platform },
      update: { userId: user.id, platform: dto.platform, active: true },
    });
  }

  @Delete('push-devices/:token')
  async removePushDevice(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    await this.prisma.pushDevice.updateMany({
      where: { userId: user.id, token },
      data: { active: false },
    });
    return { removed: true };
  }

  @Patch('phone')
  async updatePhone(@CurrentUser() user: AuthUser, @Body() dto: PhoneDto) {
    const phone = dto.phone.trim();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { phone: phone || null },
      select: { id: true },
    });
    return { phone };
  }

  @Get('phone')
  async phone(@CurrentUser() user: AuthUser) {
    const account = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { phone: true },
    });
    return { phone: account.phone };
  }

  @Get('security-sessions')
  securitySessions(@CurrentUser() user: AuthUser) {
    return this.prisma.refreshSession.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, userAgent: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Delete('security-sessions/:sessionId')
  async revokeSecuritySession(
    @CurrentUser() user: AuthUser,
    @Param('sessionId') sessionId: string,
  ) {
    await this.prisma.refreshSession.updateMany({
      where: { id: sessionId, userId: user.id },
      data: { revokedAt: new Date() },
    });
    return { revoked: true };
  }

  // Segurança da conta não depende de perfil acadêmico: admin não precisa completá-lo.
  @AllowIncompleteProfile()
  @Get('two-factor')
  async twoFactorStatus(@CurrentUser() user: AuthUser) {
    const auth = await this.prisma.twoFactorAuth.findUnique({ where: { userId: user.id } });
    return { enabled: auth?.enabled ?? false };
  }

  @AllowIncompleteProfile()
  @Post('two-factor/setup')
  async setupTwoFactor(@CurrentUser() user: AuthUser) {
    const account = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { institutionalEmail: true },
    });
    // Reconfigurar exige desativar antes, com senha: um token de acesso roubado
    // não pode trocar o segundo fator da conta.
    const current = await this.prisma.twoFactorAuth.findUnique({
      where: { userId: user.id },
      select: { enabled: true },
    });
    if (current?.enabled)
      throw new ConflictException('A verificação em duas etapas já está ativa nesta conta.');
    if (
      user.roles.includes(RoleName.ADMIN) &&
      process.env.NODE_ENV === 'production' &&
      !isTwoFactorKeyConfigured()
    )
      throw new ServiceUnavailableException({
        code: 'TWO_FACTOR_KEY_MISSING',
        message: 'O segundo fator ainda não está configurado neste ambiente.',
      });
    const secret = generateSecret();
    const encrypted = encryptTwoFactorSecret(secret);
    await this.prisma.twoFactorAuth.upsert({
      where: { userId: user.id },
      create: { userId: user.id, secret: encrypted, enabled: false },
      update: { secret: encrypted, enabled: false, recoveryCodes: [] },
    });
    const uri = generateURI({ secret, label: account.institutionalEmail, issuer: 'UniMove' });
    return {
      secret,
      qrCode: await QRCode.toDataURL(uri),
      issuer: 'UniMove',
    };
  }

  @AllowIncompleteProfile()
  @Post('two-factor/enable')
  async enableTwoFactor(@CurrentUser() user: AuthUser, @Body() dto: EnableTwoFactorDto) {
    const auth = await this.prisma.twoFactorAuth.findUnique({ where: { userId: user.id } });
    if (!auth) throw new BadRequestException('Configure o segundo fator antes de ativá-lo.');
    if (
      !(await verify({ token: dto.code, secret: decryptTwoFactorSecret(auth.secret).secret })).valid
    )
      throw new UnauthorizedException('Código de autenticação inválido.');
    await this.prisma.twoFactorAuth.update({
      where: { userId: user.id },
      data: { enabled: true },
    });
    return { enabled: true };
  }

  @AllowIncompleteProfile()
  @Post('two-factor/disable')
  async disableTwoFactor(@CurrentUser() user: AuthUser, @Body() dto: DisableTwoFactorDto) {
    const account = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (!(await argon2.verify(account.passwordHash, dto.password)))
      throw new UnauthorizedException('Senha atual inválida.');
    if (user.roles.includes(RoleName.ADMIN)) {
      const auth = await this.prisma.twoFactorAuth.findUnique({ where: { userId: user.id } });
      const valid =
        auth?.enabled &&
        dto.code &&
        (await verify({ token: dto.code, secret: decryptTwoFactorSecret(auth.secret).secret }))
          .valid;
      if (auth?.enabled && !valid)
        throw new ForbiddenException({
          code: 'ADMIN_2FA_CODE_REQUIRED',
          message: 'Administradores precisam informar o código do autenticador para desativar.',
        });
    }
    await this.prisma.twoFactorAuth.updateMany({
      where: { userId: user.id },
      data: { enabled: false, recoveryCodes: [] },
    });
    return { enabled: false };
  }

  @Post('data-export')
  async requestDataExport(@CurrentUser() user: AuthUser) {
    const request = await this.prisma.dataExportRequest.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        status: 'READY',
        format: 'JSON',
        completedAt: new Date(),
      },
    });
    return request;
  }

  @Get('data-export/:id')
  async downloadDataExport(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const request = await this.prisma.dataExportRequest.findFirst({
      where: { id, userId: user.id },
    });
    if (!request) throw new BadRequestException('Solicitação de exportação não encontrada.');
    const data = await this.prisma.$transaction(async (tx) => ({
      exportedAt: new Date().toISOString(),
      user: await tx.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          fullName: true,
          institutionalEmail: true,
          cpf: true,
          course: true,
          semester: true,
          bio: true,
          tags: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      notificationPreferences: await tx.notificationPreference.findUnique({
        where: { userId: user.id },
      }),
      privacyPreferences: await tx.privacyPreference.findUnique({ where: { userId: user.id } }),
      notifications: await tx.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
      }),
      sentMessages: await tx.chatMessage.findMany({ where: { senderId: user.id } }),
      blockedUsers: await tx.userBlock.findMany({
        where: { blockerId: user.id },
        select: { blockedId: true, createdAt: true },
      }),
    }));
    return data;
  }
}
