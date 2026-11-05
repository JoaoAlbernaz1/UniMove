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
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { AdminRoute } from '../../common/decorators/admin.decorators';
import { AllowIncompleteProfile } from '../../common/decorators/profile.decorators';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { AcademicVerificationStatus } from '../../generated/prisma/enums';
import { VerificationService } from './verification.service';

const ACADEMIC_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
const academicDocumentUpload = FileInterceptor('document', {
  limits: { fileSize: ACADEMIC_DOCUMENT_MAX_BYTES, files: 1, fields: 0 },
});

class ListAcademicVerificationsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(AcademicVerificationStatus)
  status?: AcademicVerificationStatus;
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

  @Post('academic-document')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(academicDocumentUpload)
  submitAcademicDocument(
    @CurrentUser() user: AuthUser,
    @Req() request: Request & { requestId?: string },
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.verification.submitAcademicDocument(user.id, file, request.requestId);
  }
}

@AdminRoute()
@Controller('admin/academic-verifications')
export class AdminVerificationController {
  constructor(private readonly verification: VerificationService) {}

  // Sem `status`, lista as pendentes: é o contrato que o app móvel já usa. O total
  // vai no cabeçalho para o corpo continuar sendo um array.
  @Get()
  async list(
    @Query() query: ListAcademicVerificationsDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { items, total } = await this.verification.listReviews(
      query.status ?? AcademicVerificationStatus.PENDING_REVIEW,
      (query.page - 1) * query.limit,
      query.limit,
    );
    response.setHeader('X-Total-Count', String(total));
    return items;
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
