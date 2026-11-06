import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { ChatService } from './chat.service';

class StartConversationDto {
  @IsOptional()
  @IsUUID()
  passengerId?: string;
}

class MessageQueryDto {
  @IsOptional()
  @IsUUID()
  after?: string;
}

class ReadMessagesDto {
  @IsUUID() throughMessageId!: string;
}

@ApiTags('chat')
@ApiBearerAuth()
@Controller('messages')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('conversations')
  listConversations(@CurrentUser() user: AuthUser) {
    return this.chat.listConversations(user.id);
  }

  @Get('available-participants')
  listAvailableParticipants(@CurrentUser() user: AuthUser) {
    return this.chat.listAvailableParticipants(user.id);
  }

  @Get('conversations/:id/messages')
  listMessages(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MessageQueryDto,
  ) {
    return this.chat.listMessages(user.id, id, query.after);
  }
  @Post('conversations/:id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReadMessagesDto) {
    return this.chat.markRead(user.id, id, body.throughMessageId);
  }
}

@ApiTags('chat')
@ApiBearerAuth()
@Controller('rides')
export class RideConversationsController {
  constructor(private readonly chat: ChatService) {}

  @Post(':rideId/conversations')
  startConversation(
    @CurrentUser() user: AuthUser,
    @Param('rideId', ParseUUIDPipe) rideId: string,
    @Body() dto: StartConversationDto,
  ) {
    return this.chat.startConversation(user.id, rideId, dto.passengerId);
  }
}
