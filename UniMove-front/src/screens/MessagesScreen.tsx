import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ArrowLeft, MessageCircle } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../auth/AuthContext";
import type { Me } from "../api/auth";
import type { AvailableChatParticipant, Conversation } from "../api/messages";
import { colors, fonts, maxContentWidth, radius } from "../theme";

function formatTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function MessagesScreen({
  onBack,
  onOpenConversation,
}: {
  onBack: () => void;
  onOpenConversation: (conversation: Conversation, userId: string) => void;
}) {
  const { authApi } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [availableParticipants, setAvailableParticipants] = useState<
    AvailableChatParticipant[]
  >([]);
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [startingRideId, setStartingRideId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      try {
        const [items, participants, me] = await Promise.all([
          authApi<Conversation[]>("/messages/conversations"),
          authApi<AvailableChatParticipant[]>(
            "/messages/available-participants",
          ),
          authApi<Me>("/users/me"),
        ]);
        setConversations(items);
        setAvailableParticipants(participants);
        setUser(me);
        setError(null);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível carregar as conversas.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [authApi],
  );

  async function startConversation(contact: AvailableChatParticipant) {
    if (!user || startingRideId) return;
    setStartingRideId(contact.rideId);
    try {
      const conversation = await authApi<Conversation>(
        `/rides/${contact.rideId}/conversations`,
        {
          method: "POST",
          body: JSON.stringify(
            contact.role === "DRIVER"
              ? { passengerId: contact.participant.id }
              : {},
          ),
        },
      );
      await load();
      onOpenConversation(conversation, user.id);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível iniciar a conversa.",
      );
    } finally {
      setStartingRideId(null);
    }
  }

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(true), 10000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
        >
          <ArrowLeft size={21} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>Mensagens</Text>
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.muted}>Carregando conversas...</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={() => void load()}>
            <Text style={styles.retry}>Tentar novamente</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={conversations}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load(true)}
              tintColor={colors.accent}
            />
          }
          ListHeaderComponent={
            availableParticipants.length ? (
              <View style={styles.availableSection}>
                <Text style={styles.sectionTitle}>
                  Pessoas das suas caronas
                </Text>
                {availableParticipants.map((contact) => (
                  <Pressable
                    key={`${contact.rideId}:${contact.participant.id}`}
                    onPress={() => void startConversation(contact)}
                    disabled={startingRideId !== null}
                    style={({ pressed }) => [
                      styles.card,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Iniciar conversa com ${contact.participant.fullName}`}
                  >
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {contact.participant.fullName
                          .trim()
                          .charAt(0)
                          .toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.cardCopy}>
                      <Text numberOfLines={1} style={styles.name}>
                        {contact.participant.fullName}
                      </Text>
                      <Text numberOfLines={1} style={styles.preview}>
                        {contact.originLocation.name} →{" "}
                        {contact.destinationLocation.name}
                      </Text>
                    </View>
                    {startingRideId === contact.rideId ? (
                      <ActivityIndicator color={colors.accent} />
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : undefined
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <MessageCircle size={30} color={colors.muted} />
              <Text style={styles.emptyTitle}>
                {availableParticipants.length
                  ? "Nenhuma conversa iniciada"
                  : "Nenhuma conversa disponível"}
              </Text>
              <Text style={styles.muted}>
                {availableParticipants.length
                  ? "Toque em uma pessoa acima para iniciar uma conversa."
                  : "As conversas ficam disponíveis após a confirmação de uma carona."}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const other =
              item.passengerId === user?.id ? item.ride.driver : item.passenger;
            const lastMessage = item.messages[0];
            return (
              <Pressable
                onPress={() => {
                  if (user) onOpenConversation(item, user.id);
                }}
                style={({ pressed }) => [
                  styles.card,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Conversa com ${other.fullName}`}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {other.fullName.trim().charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.cardCopy}>
                  <View style={styles.row}>
                    <Text numberOfLines={1} style={styles.name}>
                      {other.fullName}
                    </Text>
                    {lastMessage ? (
                      <Text style={styles.time}>
                        {formatTime(lastMessage.createdAt)}
                      </Text>
                    ) : null}
                  </View>
                  <Text numberOfLines={1} style={styles.preview}>
                    {lastMessage?.content ??
                      `${item.ride.originLocation.name} → ${item.ride.destinationLocation.name}`}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    minHeight: 62,
    paddingHorizontal: 16,
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
  headerTitle: { color: colors.white, fontFamily: fonts.bold, fontSize: 18 },
  list: {
    width: "100%",
    maxWidth: maxContentWidth,
    alignSelf: "center",
    padding: 16,
    gap: 10,
    flexGrow: 1,
  },
  availableSection: { gap: 10, marginBottom: 16 },
  sectionTitle: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: 15,
    marginBottom: 2,
  },
  card: {
    minHeight: 78,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 15,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.8 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  avatarText: { color: colors.white, fontFamily: fonts.bold, fontSize: 16 },
  cardCopy: { flex: 1, gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: {
    flex: 1,
    color: colors.primary,
    fontFamily: fonts.medium,
    fontSize: 14,
  },
  time: { color: colors.muted, fontFamily: fonts.regular, fontSize: 10 },
  preview: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12 },
  center: {
    flex: 1,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  empty: {
    flex: 1,
    minHeight: 250,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 22,
  },
  emptyTitle: { color: colors.primary, fontFamily: fonts.bold, fontSize: 16 },
  muted: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
  },
  error: {
    color: colors.destructive,
    fontFamily: fonts.medium,
    fontSize: 13,
    textAlign: "center",
  },
  retry: {
    color: colors.accentDark,
    fontFamily: fonts.bold,
    fontSize: 13,
    padding: 8,
  },
});
