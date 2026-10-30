import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { AchievementsService } from './achievements.service';
@Module({ controllers: [UsersController], providers: [AchievementsService] })
export class UsersModule {}
