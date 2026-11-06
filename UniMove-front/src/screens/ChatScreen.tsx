import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ArrowLeft, Send } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  createChatSocket,
  type ChatSocketAcknowledgement,
} from "../api/chatSocket";
import type { Conversation, ChatMessage } from "../api/messages";
import { useAuth } from "../auth/AuthContext";
import { colors, fonts, maxContentWidth } from "../theme";

function formatTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()]
    .sort((a, b) => {
      const byTime = a.createdAt.localeCompare(b.createdAt);
      return byTime || a.id.localeCompare(b.id);
    })
    .slice(-100);
}

export function ChatScreen({
  conversation,
  userId,
  onBack,
}: {
  conversation: Conversation;
  userId: string;
  onBack: () => void;
}) {
  const { authApi, getFreshAccessToken } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "reconnecting"
  >("connecting");
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const socketRef = useRef<ReturnType<typeof createChatSocket> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const hasLoadedHistoryRef = useRef(false);
  const syncingMessagesRef = useRef(false);
  const syncRequestedRef = useRef(false);
  const lastReadMessageRef = useRef<string | null>(null);
  const other =
    conversation.passengerId === userId
      ? conversation.ride.driver
      : conversation.passenger;
  const canSend = conversation.canSend;

  const addMessages = useCallback((incoming: ChatMessage[]) => {
    const merged = mergeMessages(messagesRef.current, incoming);
    messagesRef.current = merged;
    lastMessageIdRef.current = merged.at(-1)?.id ?? null;
    setMessages(merged);
  }, []);

  const syncMessages = useCallback(async () => {
    if (syncingMessagesRef.current) {
      syncRequestedRef.current = true;
      return;
    }

    syncingMessagesRef.current = true;
    try {
      do {
        syncRequestedRef.current = false;
        const isInitialLoad = !hasLoadedHistoryRef.current;
        let cursor = isInitialLoad ? null : lastMessageIdRef.current;
        const recovered: ChatMessage[] = [];
        let page: ChatMessage[];
        do {
          const query = cursor ? `?after=${encodeURIComponent(cursor)}` : "";
          page = await authApi<ChatMessage[]>(
            `/messages/conversations/${conversation.id}/messages${query}`,
          );
          recovered.push(...page);
          if (page.length) cursor = page[page.length - 1].id;
        } while (!isInitialLoad && page.length === 100);

        addMessages(recovered);
        hasLoadedHistoryRef.current = true;
        setError(null);
      } while (syncRequestedRef.current);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar as mensagens.",
      );
    } finally {
      syncingMessagesRef.current = false;
      setLoading(false);
    }
  }, [addMessages, authApi, conversation.id]);

  const markRead = useCallback(() => {
    if (AppState.currentState !== 'active') return;
    const message = messagesRef.current.filter((item) => item.senderId !== userId).at(-1);
    if (!message || lastReadMessageRef.current === message.id) return;
    lastReadMessageRef.current = message.id;
    void authApi(`/messages/conversations/${conversation.id}/read`, {
      method: 'POST', body: JSON.stringify({ throughMessageId: message.id }),
    }).catch(() => {
      if (lastReadMessageRef.current === message.id) lastReadMessageRef.current = null;
    });
  }, [authApi, conversation.id, userId]);

  useEffect(() => { markRead(); }, [markRead, messages]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') markRead();
    });
    return () => subscription.remove();
  }, [markRead]);

  useEffect(() => {
    let active = true;
    const socket = createChatSocket(getFreshAccessToken, (cause) => {
      if (!active) return;
      setConnectionStatus("reconnecting");
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível autenticar a conexão da conversa.",
      );
    });
    socketRef.current = socket;
    const scheduleReconnect = () => {
      if (!active || reconnectTimerRef.current) return;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (active) socket.connect();
      }, 5000);
    };

    const onMessage = (message: ChatMessage) => {
      if (!active || message.conversationId !== conversation.id) return;
      addMessages([message]);
      setError(null);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    };

    socket.on("conversation:message", onMessage);
    socket.on("connect", () => {
      socket.emit(
        "conversation:join",
        { conversationId: conversation.id },
        (ack: ChatSocketAcknowledgement) => {
          if (!active) return;
          if (!ack.ok) {
            setConnectionStatus("reconnecting");
            setError(ack.error);
            return;
          }
          setConnectionStatus("connected");
          void syncMessages();
        },
      );
    });
    socket.on("disconnect", (reason) => {
      if (!active) return;
      setConnectionStatus("reconnecting");
      if (reason === "io server disconnect") scheduleReconnect();
    });
    socket.on("connect_error", (cause: Error) => {
      if (!active) return;
      setConnectionStatus("reconnecting");
      setError(cause.message || "Não foi possível conectar à conversa.");
      if (!socket.active) scheduleReconnect();
    });

    const historySyncTimer = setTimeout(() => {
      if (active) void syncMessages();
    }, 0);
    socket.connect();
    return () => {
      active = false;
      clearTimeout(historySyncTimer);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      socketRef.current = null;
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [addMessages, conversation.id, getFreshAccessToken, syncMessages]);

  async function send() {
    const content = text.trim();
    if (!content || sending || !canSend) return;
    const socket = socketRef.current;
    if (!socket?.connected || connectionStatus !== "connected") {
      setError("Reconectando à conversa. Tente enviar sua mensagem novamente.");
      return;
    }

    setSending(true);
    try {
      await new Promise<void>((resolve, reject) => {
        socket
          .timeout(10000)
          .emit(
            "conversation:send",
            { conversationId: conversation.id, content },
            (
              timeoutError: Error | null,
              acknowledgement: ChatSocketAcknowledgement<ChatMessage>,
            ) => {
              if (timeoutError) {
                reject(
                  new Error(
                    "A mensagem demorou para ser confirmada. Tente novamente.",
                  ),
                );
                return;
              }
              if (!acknowledgement.ok) {
                reject(new Error(acknowledgement.error));
                return;
              }
              if (acknowledgement.data) addMessages([acknowledgement.data]);
              resolve();
            },
          );
      });
      setText("");
      setError(null);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível enviar a mensagem.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.keyboard}>
        <View style={styles.header}>
          <Pressable
            onPress={onBack}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Voltar para mensagens"
          >
            <ArrowLeft size={21} color={colors.white} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text numberOfLines={1} style={styles.name}>
              {other.fullName}
            </Text>
            <Text numberOfLines={1} style={styles.route}>
              {conversation.ride.originLocation.name} →{" "}
              {conversation.ride.destinationLocation.name}
            </Text>
            <Text style={styles.connectionStatus}>
              {connectionStatus === "connected"
                ? "Mensagens em tempo real"
                : connectionStatus === "connecting"
                  ? "Conectando..."
                  : "Reconectando..."}
            </Text>
          </View>
        </View>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            contentContainerStyle={styles.messages}
            data={messages}
            keyExtractor={(item) => item.id}
            onContentSizeChange={() =>
              listRef.current?.scrollToEnd({ animated: false })
            }
            ListEmptyComponent={
              <Text style={styles.empty}>
                Envie a primeira mensagem desta conversa.
              </Text>
            }
            renderItem={({ item }) => {
              const own = item.senderId === userId;
              return (
                <View
                  style={[
                    styles.bubble,
                    own ? styles.ownBubble : styles.otherBubble,
                  ]}
                >
                  <Text style={[styles.messageText, own && styles.ownText]}>
                    {item.content}
                  </Text>
                  <Text style={[styles.time, own && styles.ownTime]}>
                    {formatTime(item.createdAt)}
                  </Text>
                </View>
              );
            }}
          />
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {canSend ? (
          <View style={styles.composer}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Digite sua mensagem..."
              placeholderTextColor={colors.muted}
              maxLength={2000}
              multiline
              style={styles.input}
              accessibilityLabel="Digite sua mensagem"
            />
            <Pressable
              onPress={() => void send()}
              disabled={
                !text.trim() || sending || connectionStatus !== "connected"
              }
              style={({ pressed }) => [
                styles.sendButton,
                (!text.trim() || sending || connectionStatus !== "connected") &&
                  styles.disabled,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Enviar mensagem"
            >
              {sending ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Send size={19} color={colors.white} />
              )}
            </Pressable>
          </View>
        ) : (
          <Text style={styles.closed}>
            Reserva encerrada. O histórico desta conversa continua disponível.
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  keyboard: {
    flex: 1,
    width: "100%",
    maxWidth: maxContentWidth,
    alignSelf: "center",
    backgroundColor: colors.background,
  },
  header: {
    minHeight: 64,
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.primary,
  },
  backButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: { flex: 1, gap: 3 },
  name: { color: colors.white, fontFamily: fonts.bold, fontSize: 15 },
  route: { color: "#CBD5E1", fontFamily: fonts.regular, fontSize: 11 },
  connectionStatus: {
    color: "#A7F3D0",
    fontFamily: fonts.medium,
    fontSize: 10,
  },
  messages: { flexGrow: 1, padding: 16, gap: 10, justifyContent: "flex-end" },
  bubble: {
    maxWidth: "82%",
    paddingVertical: 10,
    paddingHorizontal: 13,
    borderRadius: 15,
    gap: 5,
  },
  ownBubble: {
    alignSelf: "flex-end",
    backgroundColor: colors.primary,
    borderBottomRightRadius: 5,
  },
  otherBubble: {
    alignSelf: "flex-start",
    backgroundColor: colors.white,
    borderBottomLeftRadius: 5,
    borderWidth: 1,
    borderColor: colors.border,
  },
  messageText: {
    color: colors.foreground,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  ownText: { color: colors.white },
  time: { color: colors.muted, fontFamily: fonts.regular, fontSize: 10 },
  ownTime: { color: "#CBD5E1", textAlign: "right" },
  empty: {
    alignSelf: "center",
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
    textAlign: "center",
    marginVertical: 18,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  error: {
    color: colors.destructive,
    fontFamily: fonts.regular,
    fontSize: 12,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  composer: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 9,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    maxHeight: 110,
    minHeight: 44,
    paddingHorizontal: 13,
    paddingVertical: 11,
    color: colors.foreground,
    fontFamily: fonts.regular,
    fontSize: 13,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  closed: {
    padding: 14,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 12,
    textAlign: "center",
    backgroundColor: colors.white,
  },
});
