import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, Matches } from 'class-validator';
import { AllowIncompleteProfile } from '../../common/decorators/profile.decorators';
import { CurrentUser, Roles } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { RoleName } from '../../generated/prisma/enums';
import { VerificationService } from './verification.service';

const ACADEMIC_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
const academicDocumentUpload = FileInterceptor('document', {
  limits: { fileSize: ACADEMIC_DOCUMENT_MAX_BYTES, files: 1, fields: 0 },
});

class VerifyEmailCodeDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Informe o código de 6 dígitos recebido por e-mail.' })
  code!: string;
}

class ReviewAcademicVerificationDto {
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reviewNote?: string;
}

@ApiBearerAuth()
@AllowIncompleteProfile()
@Controller('users/me/verification')
export class UserVerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get()
  status(@CurrentUser() user: AuthUser) {
    return this.verification.status(user.id);
  }

  @Post('email/code')
  @HttpCode(HttpStatus.OK)
  sendEmailCode(@CurrentUser() user: AuthUser) {
    return this.verification.sendEmailCode(user.id);
  }

  @Post('email/confirm')
  @HttpCode(HttpStatus.OK)
  verifyEmailCode(@CurrentUser() user: AuthUser, @Body() dto: VerifyEmailCodeDto) {
    return this.verification.verifyEmailCode(user.id, dto.code);
  }

  @Post('academic-document')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(academicDocumentUpload)
  submitAcademicDocument(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.verification.submitAcademicDocument(user.id, file);
  }
}

@ApiBearerAuth()
@Roles(RoleName.ADMIN)
@Controller('admin/academic-verifications')
export class AdminVerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get()
  list(@Query() page: PaginationDto) {
    return this.verification.listPendingReviews((page.page - 1) * page.limit, page.limit);
  }

  @Patch(':userId')
  review(
    @CurrentUser() actor: AuthUser,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: ReviewAcademicVerificationDto,
  ) {
    return this.verification.review(actor, userId, dto.status, dto.reviewNote);
  }
}
