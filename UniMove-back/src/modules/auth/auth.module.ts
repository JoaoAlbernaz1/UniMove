import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthAttemptLimiter } from './auth-attempt-limiter';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, AuthAttemptLimiter],
  exports: [JwtModule, AuthAttemptLimiter],
})
export class AuthModule {}
