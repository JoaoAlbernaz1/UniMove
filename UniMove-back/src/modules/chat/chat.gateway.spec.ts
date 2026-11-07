import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Namespace, Socket } from 'socket.io';
import type { Prisma } from '../../generated/prisma/client';
import type { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';

const userId = '11111111-1111-4111-8111-111111111111';
const conversationId = '33333333-3333-4333-8333-333333333333';
const room = `conversation:${conversationId}`;

type Message = Prisma.ChatMessageGetPayload<{
  include: { sender: { select: { id: true; fullName: true } } };
}>;

describe('ChatGateway', () => {
  const authorizeConversationAccess = jest.fn();
  const sendMessage = jest.fn();
  const chat = {
    authorizeConversationAccess,
    sendMessage,
  } as unknown as ChatService;
  const verifyAsync = jest.fn();
  const get = jest.fn().mockReturnValue([]);
  const getOrThrow = jest.fn().mockReturnValue('test-secret');
  const gateway = new ChatGateway(
    chat,
    { verifyAsync } as unknown as JwtService,
    { get, getOrThrow } as unknown as ConfigService,
  );
  const emit = jest.fn();
  const broadcast = { emit };
  const to = jest.fn().mockReturnValue(broadcast);

  beforeEach(() => {
    jest.clearAllMocks();
    const windows = (
      gateway as unknown as {
        eventWindows: Map<string, { timer: ReturnType<typeof setTimeout> }>;
      }
    ).eventWindows;
    for (const window of windows.values()) clearTimeout(window.timer);
    windows.clear();
    get.mockReturnValue([]);
    getOrThrow.mockReturnValue('test-secret');
    (gateway as unknown as { server: Namespace }).server = {
      to,
    } as unknown as Namespace;
  });

  function makeSocket(joinedRooms: string[] = []) {
    const rooms = new Set(['socket-id', ...joinedRooms]);
    return {
      data: { userId },
      rooms,
      join: jest.fn((value: string) => {
        rooms.add(value);
        return Promise.resolve();
      }),
    } as unknown as Socket;
  }

  it('only joins a conversation after the service authorizes the participant', async () => {
    authorizeConversationAccess.mockRejectedValue(
      new NotFoundException('Conversa não encontrada.'),
    );
    const socket = makeSocket();
    const acknowledge = jest.fn();

    await gateway.joinConversation(socket, { conversationId }, acknowledge);

    expect(authorizeConversationAccess).toHaveBeenCalledWith(userId, conversationId);
    expect(socket.rooms.has(room)).toBe(false);
    expect(acknowledge).toHaveBeenCalledWith({
      ok: false,
      error: 'Conversa não encontrada.',
    });
  });

  it('persists and broadcasts a message to the authorized conversation room', async () => {
    const message = {
      id: 'message-id',
      conversationId,
      senderId: userId,
      content: 'Estou chegando.',
      createdAt: new Date('2026-11-01T22:00:00.000Z'),
      sender: { id: userId, fullName: 'Passageiro' },
    } as Message;
    sendMessage.mockResolvedValue(message);
    const socket = makeSocket([room]);
    const acknowledge = jest.fn();

    await gateway.sendMessage(socket, { conversationId, content: 'Estou chegando.' }, acknowledge);

    expect(sendMessage).toHaveBeenCalledWith(userId, conversationId, 'Estou chegando.');
    expect(to).toHaveBeenCalledWith(room);
    expect(emit).toHaveBeenCalledWith('conversation:message', message);
    expect(acknowledge).toHaveBeenCalledWith({ ok: true, data: message });
  });

  it('rejects sending before joining the conversation room', async () => {
    const socket = makeSocket();
    const acknowledge = jest.fn();

    await gateway.sendMessage(socket, { conversationId, content: 'Olá' }, acknowledge);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(acknowledge).toHaveBeenCalledWith({
      ok: false,
      error: 'Entre na conversa antes de enviar mensagens.',
    });
  });

  it('limits chat events to 100 per user in a one-minute window', async () => {
    sendMessage.mockResolvedValue({
      id: 'message-id',
      conversationId,
      senderId: userId,
      content: 'Olá',
      createdAt: new Date('2026-11-01T22:00:00.000Z'),
      sender: { id: userId, fullName: 'Passageiro' },
    });
    const socket = makeSocket([room]);
    const acknowledgements = Array.from({ length: 101 }, () => jest.fn());

    for (const acknowledge of acknowledgements) {
      await gateway.sendMessage(socket, { conversationId, content: 'Olá' }, acknowledge);
    }

    expect(sendMessage).toHaveBeenCalledTimes(100);
    expect(acknowledgements[100]).toHaveBeenCalledWith({
      ok: false,
      error: 'Limite de eventos atingido. Tente novamente em breve.',
    });
  });

  it('rejects an invalid conversation identifier', async () => {
    const socket = makeSocket();
    const acknowledge = jest.fn();

    await gateway.joinConversation(socket, { conversationId: 'invalid' }, acknowledge);

    expect(authorizeConversationAccess).not.toHaveBeenCalled();
    expect(acknowledge).toHaveBeenCalledWith({
      ok: false,
      error: 'Identificador de conversa inválido.',
    });
  });

  it('rejects sockets without an access token', async () => {
    let authenticate: ((client: Socket, next: (error?: Error) => void) => void) | undefined;
    gateway.afterInit({
      use: (handler: typeof authenticate) => {
        authenticate = handler;
      },
    } as unknown as Namespace);
    const client = {
      handshake: { headers: {}, auth: {} },
      data: {},
    } as unknown as Socket;
    const next = jest.fn();

    await new Promise<void>((resolve) => {
      authenticate?.(client, (error) => {
        next(error);
        resolve();
      });
    });

    expect(verifyAsync).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('authenticates with the access secret and attaches the user to the socket', async () => {
    const expiration = Math.ceil(Date.now() / 1000) + 60;
    verifyAsync.mockResolvedValue({ sub: userId, type: 'access', exp: expiration });
    let authenticate: ((client: Socket, next: (error?: Error) => void) => void) | undefined;
    gateway.afterInit({
      use: (handler: typeof authenticate) => {
        authenticate = handler;
      },
    } as unknown as Namespace);
    const once = jest.fn();
    const client = {
      handshake: { headers: {}, auth: { token: 'access-token' } },
      data: {},
      once,
      disconnect: jest.fn(),
    } as unknown as Socket;
    const next = jest.fn();

    await new Promise<void>((resolve) => {
      authenticate?.(client, (error) => {
        next(error);
        resolve();
      });
    });
    gateway.handleDisconnect(client);

    expect(verifyAsync).toHaveBeenCalledWith('access-token', { secret: 'test-secret' });
    expect(client.data.userId).toBe(userId);
    expect(next).toHaveBeenCalledWith(undefined);
  });
});

describe('ChatGateway token scopes with real JWT verification', () => {
  const jwt = new JwtService();
  const gateway = new ChatGateway({} as ChatService, jwt, {
    get: () => [],
    getOrThrow: () => 'synthetic-chat-access-secret',
  } as unknown as ConfigService);
  let authenticate: (client: Socket, next: (error?: Error) => void) => void;

  beforeEach(() => {
    gateway.afterInit({
      use: (handler: typeof authenticate) => {
        authenticate = handler;
      },
    } as unknown as Namespace);
  });

  const handshake = async (claims: Record<string, unknown>) => {
    const token = await jwt.signAsync(
      { sub: userId, type: 'access', ...claims },
      { secret: 'synthetic-chat-access-secret', expiresIn: 300 },
    );
    const client = {
      handshake: { headers: {}, auth: { token } },
      data: {},
      once: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as Socket;
    const error = await new Promise<Error | undefined>((resolve) => authenticate(client, resolve));
    return { client, error };
  };

  it('rejects a valid administrative cookie token before attaching a socket identity or expiry timer', async () => {
    const { client, error } = await handshake({
      scope: 'admin',
      sid: 'synthetic-admin-session',
      mfa: true,
    });
    try {
      expect(error).toBeInstanceOf(Error);
      expect(client.data.userId).toBeUndefined();
      expect(client.data.tokenExpiryTimer).toBeUndefined();
    } finally {
      gateway.handleDisconnect(client);
    }
  });

  it('preserves normal student app access and cleans up its token expiry timer', async () => {
    const { client, error } = await handshake({ roles: ['PASSENGER'], mfa: false });
    try {
      expect(error).toBeUndefined();
      expect(client.data.userId).toBe(userId);
      expect(client.data.tokenExpiryTimer).toBeDefined();
    } finally {
      gateway.handleDisconnect(client);
    }
  });
});
