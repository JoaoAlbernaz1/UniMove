import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { AchievementsService } from './achievements.service';
import { ProfilePhotoService } from './profile-photo.service';
import { AccountDeletionService } from './account-deletion.service';
import { SettingsController } from './settings.controller';
import { HomeIndicatorsController, HomeIndicatorsService } from './home-indicators.controller';
@Module({
  controllers: [UsersController, SettingsController, HomeIndicatorsController],
  providers: [AchievementsService, ProfilePhotoService, AccountDeletionService, HomeIndicatorsService],
})
export class UsersModule {}
