import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Patch,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as argon2 from 'argon2';
import { IsOptional, IsString, IsStrongPassword, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { PASSWORD_ERROR, passwordOptions } from '../auth/registration-policy';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { PrismaService } from '../../database/prisma.service';
import { UserStatus } from '../../generated/prisma/enums';
import { ApiBearerAuth } from '@nestjs/swagger';
import { AllowIncompleteProfile } from '../../common/decorators/profile.decorators';
import { CompleteProfileDto } from './profile.dto';
import { PROFILE_POLICY, profileSelect } from './profile-policy';
import { AchievementsService } from './achievements.service';
import { Prisma } from '../../generated/prisma/client';
import { UpdatePersonalInfoDto } from './personal-info.dto';
import { PersonalInfoUploadPipe } from './personal-info-upload.pipe';
import { PROFILE_PHOTO_MAX_BYTES, ProfilePhotoService } from './profile-photo.service';

class UpdateMeDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MinLength(3)
  fullName?: string;
}

class ChangePasswordDto {
  @IsString() currentPassword!: string;
  @IsString() @IsStrongPassword(passwordOptions, { message: PASSWORD_ERROR }) newPassword!: string;
}

const personalInfoSelect = {
  id: true,
  fullName: true,
  institutionalEmail: true,
  studentNumber: true,
  cpf: true,
  profilePhoto: { select: { updatedAt: true } },
} as const;

const profilePhotoUpload = FileInterceptor('photo', {
  limits: { fileSize: PROFILE_PHOTO_MAX_BYTES, files: 1, fields: 1, fieldSize: 16384 },
});

@ApiBearerAuth()
@AllowIncompleteProfile()
@Controller('users/me')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly achievements: AchievementsService,
    private readonly profilePhotos: ProfilePhotoService,
  ) {}
  @Get('achievements') listAchievements(@CurrentUser() user: AuthUser) {
    return this.achievements.list(user.id);
  }
  @Get('profile-policy') policy() {
    return PROFILE_POLICY;
  }
  @Get('personal-info')
  personalInfo(@CurrentUser() user: AuthUser) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: personalInfoSelect,
    });
  }
  @Get('personal-info/photo')
  @Header('Cache-Control', 'private, no-store')
  async personalInfoPhoto(@CurrentUser() user: AuthUser) {
    const photo = await this.prisma.profilePhoto.findUnique({
      where: { userId: user.id },
      select: { image: true, mimeType: true, sizeBytes: true },
    });
    if (!photo) throw new NotFoundException('Foto de perfil não cadastrada.');
    return new StreamableFile(Buffer.from(photo.image), {
      type: photo.mimeType,
      length: photo.sizeBytes,
      disposition: 'inline',
    });
  }
  @Patch('personal-info')
  @UseInterceptors(profilePhotoUpload)
  async updatePersonalInfo(
    @CurrentUser() user: AuthUser,
    @Body('data', new PersonalInfoUploadPipe()) dto: UpdatePersonalInfoDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (dto.fullName === undefined && dto.studentNumber === undefined && !file)
      throw new BadRequestException('Informe ao menos um dado para atualizar.');

    const photo = await this.profilePhotos.image(file);
    const data: Prisma.UserUpdateInput = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.studentNumber !== undefined) data.studentNumber = dto.studentNumber;

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (Object.keys(data).length) await tx.user.update({ where: { id: user.id }, data });
        if (photo)
          await tx.profilePhoto.upsert({
            where: { userId: user.id },
            create: { userId: user.id, ...photo },
            update: photo,
          });
        return tx.user.findUniqueOrThrow({
          where: { id: user.id },
          select: personalInfoSelect,
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Essa matrícula já está vinculada a outra conta.');
      throw error;
    }
  }
  @Get() me(@CurrentUser() user: AuthUser) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: profileSelect,
    });
  }
  @Patch('profile') completeProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: CompleteProfileDto,
  ) {
    return this.prisma.user.update({
      where: { id: user.id },
      data: { ...dto, profileCompletedAt: new Date() },
      select: profileSelect,
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
