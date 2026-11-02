import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChatController, RideConversationsController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [ChatController, RideConversationsController],
  providers: [ChatService, ChatGateway],
})
export class ChatModule {}
