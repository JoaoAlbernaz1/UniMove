import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { MessagesController, RideConversationsController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [NotificationsModule],
  controllers: [MessagesController, RideConversationsController],
  providers: [MessagesService],
})
export class MessagesModule {}
