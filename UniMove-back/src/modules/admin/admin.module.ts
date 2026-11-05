import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminController } from './admin.controller';
import { AdminInsightsService } from './admin-insights.service';
import { AdminOperationsService } from './admin-operations.service';
import { AdminUsersService } from './admin-users.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [AdminAuthController, AdminController],
  providers: [AdminAuthService, AdminInsightsService, AdminOperationsService, AdminUsersService],
})
export class AdminModule {}
