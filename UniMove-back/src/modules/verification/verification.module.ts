import { Module } from '@nestjs/common';
import { AdminVerificationController, UserVerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

@Module({
  controllers: [UserVerificationController, AdminVerificationController],
  providers: [VerificationService],
  exports: [VerificationService],
})
export class VerificationModule {}
