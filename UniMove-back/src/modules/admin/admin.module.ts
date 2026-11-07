import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminEnrollmentService } from './admin-enrollment.service';
import { AdminController } from './admin.controller';
import { AdminInsightsService } from './admin-insights.service';
import { AdminInvitesService } from './admin-invites.service';
import { AdminOnboardingController } from './admin-onboarding.controller';
import { AdminOperationsService } from './admin-operations.service';
import { AdminPermissionsGuard } from './admin-permission.guard';
import { AdminReauthService } from './admin-reauth.service';
import { AdminRecoveryService } from './admin-recovery.service';
import { AdminSecurityService } from './admin-security.service';
import { AdminSessionsService } from './admin-sessions.service';
import { AdminUsersService } from './admin-users.service';

@Module({
  imports: [AuthModule, MailModule, NotificationsModule],
  controllers: [
    AdminAuthController,
    // Antes de AdminController: rotas fixas como admin/permissions precisam ser
    // registradas sem disputa com parâmetros de outras rotas administrativas.
    AdminAccountsController,
    AdminOnboardingController,
    AdminController,
  ],
  providers: [
    AdminAccountsService,
    AdminAuthService,
    AdminEnrollmentService,
    AdminInsightsService,
    AdminInvitesService,
    AdminOperationsService,
    AdminPermissionsGuard,
    AdminReauthService,
    AdminRecoveryService,
    AdminSecurityService,
    AdminSessionsService,
    AdminUsersService,
  ],
})
export class AdminModule {}
