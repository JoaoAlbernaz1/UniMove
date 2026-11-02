import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { AchievementsService } from './achievements.service';
import { ProfilePhotoService } from './profile-photo.service';
import { AccountDeletionService } from './account-deletion.service';
import { SettingsController } from './settings.controller';
@Module({
  controllers: [UsersController, SettingsController],
  providers: [AchievementsService, ProfilePhotoService, AccountDeletionService],
})
export class UsersModule {}
