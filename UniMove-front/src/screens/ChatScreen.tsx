import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ArrowLeft, Send } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Conversation, ChatMessage } from "../api/messages";
import { useAuth } from "../auth/AuthContext";
import { colors, fonts, maxContentWidth } from "../theme";

function formatTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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
  const { authApi } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const loadingRef = useRef(false);
  const other =
    conversation.passengerId === userId
      ? conversation.ride.driver
      : conversation.passenger;
  const canSend = conversation.canSend;

  const loadMessages = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const next = await authApi<ChatMessage[]>(
        `/messages/conversations/${conversation.id}/messages`,
      );
      setMessages(next);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar as mensagens.",
      );
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [authApi, conversation.id]);

  useEffect(() => {
    void loadMessages();
    const interval = setInterval(() => void loadMessages(), 4000);
    return () => clearInterval(interval);
  }, [loadMessages]);

  async function send() {
    const content = text.trim();
    if (!content || sending || !canSend) return;
    setSending(true);
    try {
      const sent = await authApi<ChatMessage>(
        `/messages/conversations/${conversation.id}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ content }),
        },
      );
      setMessages((current) =>
        current.some((item) => item.id === sent.id)
          ? current
          : [...current, sent].slice(-100),
      );
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
              disabled={!text.trim() || sending}
              style={({ pressed }) => [
                styles.sendButton,
                (!text.trim() || sending) && styles.disabled,
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
