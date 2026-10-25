import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { MessagesService } from './messages.service';

class CreateConversationDto {
  @IsOptional()
  @IsUUID()
  passengerId?: string;
}

class SendMessageDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;
}

class MessageQueryDto {
  @IsOptional()
  @IsUUID()
  after?: string;
}

@ApiTags('messages')
@ApiBearerAuth()
@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get('conversations')
  listConversations(@CurrentUser() user: AuthUser) {
    return this.messages.listConversations(user.id);
  }

  @Get('available-participants')
  listAvailableParticipants(@CurrentUser() user: AuthUser) {
    return this.messages.listAvailableParticipants(user.id);
  }

  @Get('conversations/:id/messages')
  listMessages(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: MessageQueryDto,
  ) {
    return this.messages.listMessages(user.id, id, query.after);
  }

  @Post('conversations/:id/messages')
  sendMessage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.messages.sendMessage(user.id, id, dto.content);
  }
}

@ApiTags('messages')
@ApiBearerAuth()
@Controller('rides')
export class RideConversationsController {
  constructor(private readonly messages: MessagesService) {}

  @Post(':rideId/conversations')
  startConversation(
    @CurrentUser() user: AuthUser,
    @Param('rideId') rideId: string,
    @Body() dto: CreateConversationDto,
  ) {
    return this.messages.startConversation(user.id, rideId, dto.passengerId);
  }
}
