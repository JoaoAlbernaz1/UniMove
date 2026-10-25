import {
  ArrowLeft,
  MessageCircle,
  RefreshCw,
  Send,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type {
  AvailableChatParticipant,
  ChatConversation,
  ChatMessage,
} from '../api/messages';
import { useAuth } from '../auth/AuthContext';
import { colors, fonts, maxContentWidth, radius } from '../theme';

type Profile = { id: string };

function formatTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatConversationTime(value: string) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return formatTime(value);
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date);
}

function getInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || '?';
}

function getOtherParticipant(conversation: ChatConversation, userId: string) {
  return conversation.passengerId === userId
    ? conversation.ride.driver
    : conversation.passenger;
}

function compareMessages(a: ChatMessage, b: ChatMessage) {
  const timeDifference = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  return timeDifference || a.id.localeCompare(b.id);
}

export function MessagesScreen({ onBack }: { onBack: () => void }) {
  const { authApi } = useAuth();
  const [userId, setUserId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [availableParticipants, setAvailableParticipants] = useState<AvailableChatParticipant[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [startingRideId, setStartingRideId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const latestMessageId = useRef<string | null>(null);
  const latestMessage = useRef<ChatMessage | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const loadInbox = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    const [profileResult, conversationsResult, participantsResult] = await Promise.allSettled([
      authApi<Profile>('/users/me'),
      authApi<ChatConversation[]>('/messages/conversations'),
      authApi<AvailableChatParticipant[]>('/messages/available-participants'),
    ]);

    const errors: string[] = [];
    if (profileResult.status === 'fulfilled') setUserId(profileResult.value.id);
    else errors.push('Não foi possível identificar sua conta.');
    if (conversationsResult.status === 'fulfilled') setConversations(conversationsResult.value);
    else errors.push('Não foi possível carregar suas conversas.');
    if (participantsResult.status === 'fulfilled')
      setAvailableParticipants(participantsResult.value);
    else errors.push('Não foi possível carregar os contatos das suas caronas.');

    setError(errors.length ? errors.join(' ') : null);
    if (!silent) setLoading(false);
  }, [authApi]);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    if (selectedConversation) return;
    const interval = setInterval(() => void loadInbox(true), 10000);
    return () => clearInterval(interval);
  }, [loadInbox, selectedConversation?.id]);

  useEffect(() => {
    latestMessageId.current = null;
    latestMessage.current = null;
    setMessages([]);
    setMessagesError(null);
    if (!selectedConversation) return;

    let active = true;
    let inFlight = false;
    setMessagesLoading(true);

    const loadMessages = async () => {
      if (inFlight) return;
      inFlight = true;
      const cursor = latestMessageId.current;
      const query = cursor ? `?after=${encodeURIComponent(cursor)}` : '';
      try {
        const result = await authApi<ChatMessage[]>(
          `/messages/conversations/${selectedConversation.id}/messages${query}`,
        );
        if (!active) return;
        if (result.length) {
          setMessages((current) => {
            const byId = new Map(current.map((message) => [message.id, message]));
            result.forEach((message) => byId.set(message.id, message));
            return [...byId.values()].sort(compareMessages);
          });
          const newest = result[result.length - 1];
          if (!latestMessage.current || compareMessages(newest, latestMessage.current) > 0) {
            latestMessage.current = newest;
            latestMessageId.current = newest.id;
          }
          setMessagesError(null);
        }
      } catch (reason) {
        if (active) {
          setMessagesError(reason instanceof Error
            ? reason.message
            : 'Não foi possível carregar as mensagens.');
        }
      } finally {
        inFlight = false;
        if (active) setMessagesLoading(false);
      }
    };

    void loadMessages();
    const interval = setInterval(() => void loadMessages(), 4000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [authApi, selectedConversation?.id]);

  const openConversation = (conversation: ChatConversation) => {
    setSelectedConversation(conversation);
  };

  const startConversation = async (contact: AvailableChatParticipant) => {
    if (startingRideId) return;
    setStartingRideId(contact.rideId);
    setError(null);
    try {
      const conversation = await authApi<ChatConversation>(
        `/rides/${contact.rideId}/conversations`,
        {
          method: 'POST',
          body: JSON.stringify(
            contact.role === 'DRIVER' ? { passengerId: contact.participant.id } : {},
          ),
        },
      );
      setSelectedConversation(conversation);
      setConversations((current) => [
        conversation,
        ...current.filter(({ id }) => id !== conversation.id),
      ]);
      setAvailableParticipants((current) =>
        current.filter(
          ({ rideId, participant }) =>
            rideId !== contact.rideId || participant.id !== contact.participant.id,
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível abrir a conversa.');
    } finally {
      setStartingRideId(null);
    }
  };

  const sendMessage = async () => {
    const content = draft.trim();
    if (!content || sending || !selectedConversation) return;
    setSending(true);
    setMessagesError(null);
    try {
      const message = await authApi<ChatMessage>(
        `/messages/conversations/${selectedConversation.id}/messages`,
        { method: 'POST', body: JSON.stringify({ content }) },
      );
      setMessages((current) => {
        const byId = new Map(current.map((item) => [item.id, item]));
        byId.set(message.id, message);
        return [...byId.values()].sort(compareMessages);
      });
      if (!latestMessage.current || compareMessages(message, latestMessage.current) > 0) {
        latestMessage.current = message;
        latestMessageId.current = message.id;
      }
      setDraft('');
    } catch (reason) {
      setMessagesError(reason instanceof Error ? reason.message : 'Não foi possível enviar a mensagem.');
    } finally {
      setSending(false);
    }
  };

  const returnToInbox = () => {
    setSelectedConversation(null);
    setDraft('');
    void loadInbox();
  };

  const otherParticipant = selectedConversation && userId
    ? getOtherParticipant(selectedConversation, userId)
    : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.page}>
        <View style={styles.header}>
          <Pressable
            onPress={selectedConversation ? returnToInbox : onBack}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel={selectedConversation ? 'Voltar para mensagens' : 'Voltar para início'}
          >
            <ArrowLeft size={21} color={colors.white} />
          </Pressable>
          {selectedConversation && otherParticipant ? (
            <View style={styles.headerIdentity}>
              <View style={styles.headerAvatar}>
                <Text style={styles.avatarText}>{getInitial(otherParticipant.fullName)}</Text>
              </View>
              <View style={styles.headerCopy}>
                <Text style={styles.headerTitle} numberOfLines={1}>{otherParticipant.fullName}</Text>
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  {selectedConversation.ride.originLocation.name}
                  {' → '}
                  {selectedConversation.ride.destinationLocation.name}
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.inboxHeaderCopy}>
              <Text style={styles.headerTitle}>Mensagens</Text>
              <Text style={styles.headerSubtitle}>Converse sobre suas caronas</Text>
            </View>
          )}
          {!selectedConversation ? (
            <Pressable
              onPress={() => void loadInbox()}
              style={styles.refreshButton}
              accessibilityRole="button"
              accessibilityLabel="Atualizar mensagens"
            >
              <RefreshCw size={18} color={colors.white} />
            </Pressable>
          ) : null}
        </View>

        {selectedConversation && otherParticipant ? (
          <KeyboardAvoidingView
            style={styles.chat}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
          >
            <ScrollView
              ref={scrollRef}
              style={styles.messageScroll}
              contentContainerStyle={styles.messageContent}
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
              keyboardShouldPersistTaps="handled"
            >
              {messagesLoading && !messages.length ? (
                <View style={styles.centerState}>
                  <ActivityIndicator color={colors.accentDark} />
                </View>
              ) : null}
              {messagesError ? (
                <Pressable onPress={() => setMessagesError(null)} style={styles.inlineError}>
                  <Text style={styles.errorText}>{messagesError}</Text>
                </Pressable>
              ) : null}
              {!messagesLoading && !messages.length ? (
                <View style={styles.emptyChat}>
                  <View style={styles.emptyIcon}>
                    <MessageCircle size={22} color={colors.accentDark} />
                  </View>
                  <Text style={styles.emptyTitle}>Inicie a conversa</Text>
                  <Text style={styles.emptyText}>
                    Combine os detalhes da carona diretamente com {otherParticipant.fullName}.
                  </Text>
                </View>
              ) : null}
              {messages.map((message) => {
                const sentByMe = message.senderId === userId;
                return (
                  <View
                    key={message.id}
                    style={[styles.messageRow, sentByMe && styles.myMessageRow]}
                  >
                    <View style={[styles.bubble, sentByMe ? styles.myBubble : styles.theirBubble]}>
                      <Text style={[styles.messageText, sentByMe && styles.myMessageText]}>
                        {message.content}
                      </Text>
                      <Text style={[styles.messageTime, sentByMe && styles.myMessageTime]}>
                        {formatTime(message.createdAt)}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
            <View style={styles.composer}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Digite sua mensagem..."
                placeholderTextColor={colors.muted}
                style={styles.input}
                multiline
                maxLength={2000}
                accessibilityLabel="Digite sua mensagem"
                onSubmitEditing={() => void sendMessage()}
              />
              <Pressable
                onPress={() => void sendMessage()}
                disabled={!draft.trim() || sending}
                style={({ pressed }) => [
                  styles.sendButton,
                  (!draft.trim() || sending) && styles.sendButtonDisabled,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Enviar mensagem"
              >
                {sending
                  ? <ActivityIndicator size="small" color={colors.white} />
                  : <Send size={19} color={colors.white} />}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        ) : (
          <ScrollView contentContainerStyle={styles.inboxContent}>
            {error ? (
              <View style={styles.inlineError}>
                <Text style={styles.errorText}>{error}</Text>
                <Pressable onPress={() => void loadInbox()} accessibilityRole="button">
                  <Text style={styles.retryText}>Tentar novamente</Text>
                </Pressable>
              </View>
            ) : null}
            {loading ? (
              <View style={styles.centerState}>
                <ActivityIndicator color={colors.accentDark} />
                <Text style={styles.emptyText}>Carregando mensagens...</Text>
              </View>
            ) : (
              <>
                <Text style={styles.sectionTitle}>Suas conversas</Text>
                {conversations.length ? (
                  <View style={styles.list}>
                    {conversations.map((conversation) => {
                      const participant = userId
                        ? getOtherParticipant(conversation, userId)
                        : conversation.ride.driver;
                      const latest = conversation.messages[0];
                      return (
                        <Pressable
                          key={conversation.id}
                          onPress={() => openConversation(conversation)}
                          style={({ pressed }) => [styles.conversationCard, pressed && styles.pressed]}
                          accessibilityRole="button"
                        >
                          <View style={styles.avatar}>
                            <Text style={styles.avatarText}>{getInitial(participant.fullName)}</Text>
                          </View>
                          <View style={styles.conversationCopy}>
                            <View style={styles.conversationTitleRow}>
                              <Text style={styles.participantName} numberOfLines={1}>
                                {participant.fullName}
                              </Text>
                              <Text style={styles.timestamp}>
                                {formatConversationTime(latest?.createdAt ?? conversation.updatedAt)}
                              </Text>
                            </View>
                            <Text style={styles.preview} numberOfLines={1}>
                              {latest?.content ?? 'Conversa iniciada'}
                            </Text>
                            <Text style={styles.rideLabel} numberOfLines={1}>
                              {conversation.ride.originLocation.name}
                              {' → '}
                              {conversation.ride.destinationLocation.name}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <View style={styles.emptyInbox}>
                    <View style={styles.emptyIcon}>
                      <MessageCircle size={22} color={colors.accentDark} />
                    </View>
                    <Text style={styles.emptyTitle}>Nenhuma conversa ainda</Text>
                    <Text style={styles.emptyText}>
                      Inicie uma conversa com alguém de uma carona confirmada.
                    </Text>
                  </View>
                )}

                {availableParticipants.length ? (
                  <>
                    <Text style={[styles.sectionTitle, styles.availableHeading]}>
                      Iniciar conversa
                    </Text>
                    <View style={styles.list}>
                      {availableParticipants.map((contact) => (
                        <Pressable
                          key={`${contact.rideId}:${contact.participant.id}`}
                          onPress={() => void startConversation(contact)}
                          disabled={startingRideId === contact.rideId}
                          style={({ pressed }) => [styles.contactCard, pressed && styles.pressed]}
                          accessibilityRole="button"
                        >
                          <View style={styles.avatar}>
                            <Text style={styles.avatarText}>
                              {getInitial(contact.participant.fullName)}
                            </Text>
                          </View>
                          <View style={styles.conversationCopy}>
                            <Text style={styles.participantName} numberOfLines={1}>
                              {contact.participant.fullName}
                            </Text>
                            <Text style={styles.preview} numberOfLines={1}>
                              {contact.originLocation.name}
                              {' → '}
                              {contact.destinationLocation.name}
                            </Text>
                            <Text style={styles.rideLabel}>
                              Carona em {formatConversationTime(contact.departureAt)}
                            </Text>
                          </View>
                          {startingRideId === contact.rideId
                            ? <ActivityIndicator color={colors.accentDark} />
                            : <MessageCircle size={19} color={colors.accentDark} />}
                        </Pressable>
                      ))}
                    </View>
                  </>
                ) : null}
              </>
            )}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.primary },
  page: { flex: 1, alignItems: 'center', backgroundColor: colors.background },
  header: {
    width: '100%',
    minHeight: 76,
    paddingHorizontal: 16,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    width: 38,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.bold, fontSize: 14, color: colors.white },
  headerCopy: { flex: 1, gap: 2 },
  inboxHeaderCopy: { flex: 1, gap: 2 },
  headerTitle: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22, color: colors.white },
  headerSubtitle: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: '#CBD5E1' },
  refreshButton: { width: 38, height: 42, alignItems: 'center', justifyContent: 'center' },
  inboxContent: {
    width: '100%',
    maxWidth: maxContentWidth,
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 32,
  },
  sectionTitle: {
    marginBottom: 12,
    fontFamily: fonts.bold,
    fontSize: 15,
    lineHeight: 21,
    color: colors.primary,
  },
  availableHeading: { marginTop: 26 },
  list: { gap: 9 },
  conversationCard: {
    minHeight: 74,
    padding: 12,
    borderRadius: 15,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  contactCard: {
    minHeight: 74,
    padding: 12,
    borderRadius: 15,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  conversationCopy: { flex: 1, gap: 3 },
  conversationTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  participantName: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.primary,
  },
  timestamp: { fontFamily: fonts.regular, fontSize: 10, color: colors.muted },
  preview: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: colors.muted },
  rideLabel: { fontFamily: fonts.regular, fontSize: 10, lineHeight: 14, color: colors.accentDark },
  emptyInbox: { minHeight: 210, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: colors.accentBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 20, color: colors.primary },
  emptyText: {
    maxWidth: 290,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
    textAlign: 'center',
  },
  centerState: { flex: 1, minHeight: 150, alignItems: 'center', justifyContent: 'center', gap: 10 },
  inlineError: {
    padding: 12,
    marginBottom: 12,
    borderRadius: 12,
    backgroundColor: colors.destructiveBg,
    gap: 6,
  },
  errorText: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: colors.destructive },
  retryText: { fontFamily: fonts.bold, fontSize: 12, color: colors.accentDark },
  chat: { width: '100%', maxWidth: maxContentWidth, flex: 1, backgroundColor: '#F1F5F9' },
  messageScroll: { flex: 1 },
  messageContent: { flexGrow: 1, padding: 16, paddingTop: 20, gap: 10 },
  messageRow: { width: '100%', alignItems: 'flex-start' },
  myMessageRow: { alignItems: 'flex-end' },
  bubble: { maxWidth: '84%', paddingHorizontal: 13, paddingTop: 10, paddingBottom: 8, borderRadius: 15 },
  theirBubble: { backgroundColor: colors.white, borderBottomLeftRadius: 5 },
  myBubble: { backgroundColor: colors.primary, borderBottomRightRadius: 5 },
  messageText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.foreground },
  myMessageText: { color: colors.white },
  messageTime: { marginTop: 4, fontFamily: fonts.regular, fontSize: 9, color: colors.muted },
  myMessageTime: { color: '#CBD5E1', textAlign: 'right' },
  emptyChat: { flex: 1, minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 8 },
  composer: {
    width: '100%',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 9,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 110,
    paddingHorizontal: 13,
    paddingTop: 11,
    paddingBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.inputBg,
    color: colors.foreground,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.55 },
  pressed: { opacity: 0.8 },
});
