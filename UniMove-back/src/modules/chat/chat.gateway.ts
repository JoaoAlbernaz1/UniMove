import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  Ack,
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { isUUID } from 'class-validator';
import { SkipThrottle } from '@nestjs/throttler';
import type { Namespace, Socket } from 'socket.io';
import type { Prisma } from '../../generated/prisma/client';
import { ChatService } from './chat.service';

type AccessPayload = {
  sub: string;
  type: 'access';
  exp: number;
  scope?: 'admin';
};
type ChatMessage = Prisma.ChatMessageGetPayload<{
  include: { sender: { select: { id: true; fullName: true } } };
}>;

type ClientAck<T = never> = (result: { ok: true; data?: T } | { ok: false; error: string }) => void;

const CHAT_EVENT_LIMIT = 100;
const CHAT_EVENT_WINDOW_MS = 60_000;

type EventWindow = {
  count: number;
  expiresAt: number;
  timer: NodeJS.Timeout;
};

const roomForConversation = (conversationId: string) => `conversation:${conversationId}`;

@Injectable()
@SkipThrottle()
@WebSocketGateway({ namespace: '/chat', transports: ['websocket'] })
export class ChatGateway implements OnGatewayInit<Namespace> {
  private readonly logger = new Logger(ChatGateway.name);
  private readonly eventWindows = new Map<string, EventWindow>();

  @WebSocketServer()
  private server!: Namespace;

  constructor(
    private readonly chat: ChatService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  afterInit(server: Namespace) {
    server.use((client, next) => {
      void this.authenticate(client, next);
    });
  }

  handleDisconnect(client: Socket) {
    const timer = client.data.tokenExpiryTimer as NodeJS.Timeout | undefined;
    if (timer) clearTimeout(timer);
  }

  @SubscribeMessage('conversation:join')
  async joinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
    @Ack() acknowledge: ClientAck | undefined,
  ) {
    if (this.isRateLimited(client.data.userId)) {
      acknowledge?.({ ok: false, error: 'Limite de eventos atingido. Tente novamente em breve.' });
      return;
    }

    const conversationId = this.readConversationId(payload);
    if (!conversationId) {
      acknowledge?.({ ok: false, error: 'Identificador de conversa inválido.' });
      return;
    }

    try {
      await this.chat.authorizeConversationAccess(client.data.userId, conversationId);
      await client.join(roomForConversation(conversationId));
      acknowledge?.({ ok: true });
    } catch (error) {
      this.acknowledgeError(acknowledge, error, 'Não foi possível acessar a conversa.');
    }
  }

  @SubscribeMessage('conversation:send')
  async sendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
    @Ack() acknowledge: ClientAck<ChatMessage> | undefined,
  ) {
    if (this.isRateLimited(client.data.userId)) {
      acknowledge?.({ ok: false, error: 'Limite de eventos atingido. Tente novamente em breve.' });
      return;
    }

    const input = this.readMessageInput(payload);
    if (!input) {
      acknowledge?.({ ok: false, error: 'Informe uma conversa e uma mensagem válida.' });
      return;
    }

    const room = roomForConversation(input.conversationId);
    if (!client.rooms.has(room)) {
      acknowledge?.({ ok: false, error: 'Entre na conversa antes de enviar mensagens.' });
      return;
    }

    try {
      const message = await this.chat.sendMessage(
        client.data.userId,
        input.conversationId,
        input.content,
      );
      this.server.to(room).emit('conversation:message', message);
      acknowledge?.({ ok: true, data: message });
    } catch (error) {
      this.acknowledgeError(acknowledge, error, 'Não foi possível enviar a mensagem.');
    }
  }

  private async authenticate(client: Socket, next: (error?: Error) => void) {
    const origin = client.handshake.headers.origin;
    const allowedOrigins = this.config.get<string[]>('app.corsOrigins') ?? [];
    if (origin && !allowedOrigins.includes(origin)) {
      next(new Error('Origem não autorizada.'));
      return;
    }

    const token = client.handshake.auth?.token;
    if (typeof token !== 'string' || !token) {
      next(new Error('Token de acesso ausente.'));
      return;
    }

    try {
      const payload = await this.jwt.verifyAsync<AccessPayload>(token, {
        secret: this.config.getOrThrow<string>('auth.accessSecret'),
      });
      if (
        payload.type !== 'access' ||
        payload.scope === 'admin' ||
        typeof payload.sub !== 'string' ||
        !Number.isInteger(payload.exp)
      ) {
        next(new Error('Token de acesso inválido.'));
        return;
      }

      client.data.userId = payload.sub;
      const expiryDelay = Math.max(payload.exp * 1000 - Date.now(), 0);
      const expiryTimer = setTimeout(() => client.disconnect(true), expiryDelay);
      expiryTimer.unref();
      client.data.tokenExpiryTimer = expiryTimer;
      client.once('disconnect', () => clearTimeout(expiryTimer));
      next();
    } catch {
      next(new Error('Token de acesso inválido ou expirado.'));
    }
  }

  private readConversationId(payload: unknown) {
    if (!payload || typeof payload !== 'object' || !('conversationId' in payload)) return null;
    const conversationId = payload.conversationId;
    return typeof conversationId === 'string' && isUUID(conversationId) ? conversationId : null;
  }

  private readMessageInput(payload: unknown) {
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('conversationId' in payload) ||
      !('content' in payload) ||
      typeof payload.content !== 'string'
    )
      return null;
    const conversationId = payload.conversationId;
    if (typeof conversationId !== 'string' || !isUUID(conversationId)) return null;
    return { conversationId, content: payload.content };
  }

  private acknowledgeError(acknowledge: ClientAck | undefined, error: unknown, fallback: string) {
    if (!acknowledge) return;

    if (error instanceof HttpException) {
      const response = error.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : typeof response === 'object' &&
              response !== null &&
              'message' in response &&
              typeof response.message === 'string'
            ? response.message
            : error.message;
      acknowledge({ ok: false, error: message });
      return;
    }

    this.logger.error(
      'Falha inesperada ao processar evento de conversa.',
      error instanceof Error ? error.stack : undefined,
    );
    acknowledge({ ok: false, error: fallback });
  }

  private isRateLimited(userId: string) {
    const now = Date.now();
    let window = this.eventWindows.get(userId);
    if (!window || now >= window.expiresAt) {
      if (window) clearTimeout(window.timer);
      const expiresAt = now + CHAT_EVENT_WINDOW_MS;
      const timer = setTimeout(() => {
        if (this.eventWindows.get(userId)?.expiresAt === expiresAt)
          this.eventWindows.delete(userId);
      }, CHAT_EVENT_WINDOW_MS);
      timer.unref();
      window = { count: 0, expiresAt, timer };
      this.eventWindows.set(userId, window);
    }

    if (window.count >= CHAT_EVENT_LIMIT) return true;
    window.count += 1;
    return false;
  }
}
