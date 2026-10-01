import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { PrismaService } from '../../database/prisma.service';
import { UserStatus } from '../../generated/prisma/enums';
import { ApiBearerAuth } from '@nestjs/swagger';

class UpdateMeDto {
  @IsOptional() @IsString() @MinLength(3) fullName?: string;
}

class ChangePasswordDto {
  @IsString() currentPassword!: string;
  @IsString() @MinLength(8) newPassword!: string;
}

@ApiBearerAuth()
@Controller('users/me')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}
  @Get() me(@CurrentUser() user: AuthUser) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        id: true,
        fullName: true,
        institutionalEmail: true,
        status: true,
        createdAt: true,
        roles: { select: { role: { select: { name: true } } } },
      },
    });
  }
  @Patch() update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.prisma.user.update({
      where: { id: user.id },
      data: dto,
      select: { id: true, fullName: true, institutionalEmail: true },
    });
  }
  @Patch('password') async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ) {
    const account = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await argon2.verify(account.passwordHash, dto.currentPassword))) {
      throw new UnauthorizedException('Senha atual inválida.');
    }
    const passwordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      this.prisma.refreshSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'PASSWORD_CHANGED',
          entityType: 'User',
          entityId: user.id,
        },
      }),
    ]);
    return { changed: true };
  }
  @Delete() @HttpCode(204) async deactivate(@CurrentUser() user: AuthUser) {
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        status: UserStatus.DEACTIVATED,
        deletedAt: new Date(),
        fullName: 'Usuário desativado',
      },
    });
  }
}
