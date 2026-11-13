import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { MessagesScreen } from './src/screens/MessagesScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { RegisterScreen } from './src/screens/RegisterScreen';
import { SearchRideScreen } from './src/screens/SearchRideScreen';
import { RideRequestsScreen } from './src/screens/RideRequestsScreen';
import { OfferRideScreen } from './src/screens/OfferRideScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { RegisterVehicleScreen } from './src/screens/RegisterVehicleScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { PersonalInfoScreen } from './src/screens/PersonalInfoScreen';
import { AdminVerificationScreen } from './src/screens/AdminVerificationScreen';
import { NotificationSettingsScreen } from './src/screens/NotificationSettingsScreen';
import { NotificationsScreen } from './src/screens/NotificationsScreen';
import type { NotificationTarget } from './src/notifications';
import { PrivacyScreen } from './src/screens/PrivacyScreen';
import { HelpCenterScreen } from './src/screens/HelpCenterScreen';
import type { Conversation } from './src/api/messages';
import { colors } from './src/theme';
import { AdvertisementBar } from './src/components/AdvertisementBar';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { CompleteProfileScreen } from './src/screens/CompleteProfileScreen';
import { getMyProfile, type Profile } from './src/services/profileService';
import { Button } from './src/components/Button';
import { Message } from './src/components/Message';
import type { Me } from './src/api/auth';
import { getIdentityVerificationStatus } from './src/services/identityVerificationService';

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_700Bold,
  });
  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Root />
      </AuthProvider>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}

function Root() {
  const { status } = useAuth();
  if (status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return status === 'signedIn' ? <SignedInSession /> : <SignedOutApp />;
}

function SignedInSession() {
  const { authApi, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    getMyProfile(authApi)
      .then((result) => {
        if (active) setProfile(result);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Não foi possível carregar seu perfil.',
          );
      });
    return () => {
      active = false;
    };
  }, [authApi, attempt]);
  let content: ReactNode;
  if (error)
    content = (
      <View style={styles.profileError}>
        <Message tone="error">{error}</Message>
        <Button
          title="Tentar novamente"
          variant="outline"
          onPress={() => {
            setError(null);
            setAttempt((value) => value + 1);
          }}
        />
        <Button title="Sair da conta" onPress={() => void signOut()} />
      </View>
    );
  else if (!profile)
    content = (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  else if (!profile.profileCompletedAt)
    content = (
      <CompleteProfileScreen profile={profile} onCompleted={setProfile} />
    );
  else content = <SignedInApp />;
  return <UserLayout>{content}</UserLayout>;
}

function UserLayout({ children }: { children: ReactNode }) {
  return (
    <KeyboardAvoidingView
      style={styles.userLayout}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.screen}>{children}</View>
      <AdvertisementBar />
    </KeyboardAvoidingView>
  );
}

function SignedOutApp() {
  const [signedOutScreen, setSignedOutScreen] = useState<
    'Welcome' | 'Login' | 'Register'
  >('Welcome');
  if (signedOutScreen === 'Register') {
    return <RegisterScreen onBack={() => setSignedOutScreen('Login')} />;
  }
  if (signedOutScreen === 'Login') {
    return <LoginScreen onRegister={() => setSignedOutScreen('Register')} />;
  }
  return <WelcomeScreen onStart={() => setSignedOutScreen('Login')} />;
}

function SignedInApp() {
  const { authApi } = useAuth();
  const [loggedScreen, setLoggedScreen] = useState<
    | 'Home'
    | 'SearchRide'
    | 'DriverRequests'
    | 'PassengerRequests'
    | 'OfferRide'
    | 'Messages'
    | 'Chat'
    | 'Profile'
    | 'RegisterVehicle'
    | 'History'
    | 'Settings'
    | 'PersonalInfo'
    | 'AdminVerification'
    | 'Notifications'
    | 'NotificationCenter'
    | 'Privacy'
    | 'Help'
  >('Home');
  const [activeConversation, setActiveConversation] =
    useState<Conversation | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [profileUserId, setProfileUserId] = useState<string>('');
  const [vehicleReturnScreen, setVehicleReturnScreen] = useState<'Home' | 'Profile'>('Profile');
  const [checkingVehicleOffer, setCheckingVehicleOffer] = useState(false);
  const [vehicleOfferError, setVehicleOfferError] = useState<string | null>(null);
  const [vehicleNeedsVerification, setVehicleNeedsVerification] = useState(false);
  const [openVerificationOnPersonalInfo, setOpenVerificationOnPersonalInfo] =
    useState(false);
  // Telas abertas pela central de notificações voltam para ela.
  const [returnToNotifications, setReturnToNotifications] = useState(false);
  const [notificationSettingsReturn, setNotificationSettingsReturn] = useState<
    'Settings' | 'NotificationCenter'
  >('Settings');

  // Chegar à Home por qualquer caminho encerra a navegação iniciada na central.
  if (loggedScreen === 'Home' && returnToNotifications)
    setReturnToNotifications(false);

  function back(fallback: typeof loggedScreen) {
    return () => {
      if (returnToNotifications) {
        setReturnToNotifications(false);
        setLoggedScreen('NotificationCenter');
      } else setLoggedScreen(fallback);
    };
  }

  async function openNotificationTarget(
    target: Exclude<NotificationTarget, null>,
  ) {
    if (target.screen === 'Home') {
      setReturnToNotifications(false);
      setLoggedScreen('Home');
      return;
    }
    setReturnToNotifications(true);
    if (target.screen === 'Chat') {
      try {
        const [conversations, currentUser] = await Promise.all([
          authApi<Conversation[]>('/messages/conversations'),
          authApi<Me>('/users/me'),
        ]);
        const conversation = conversations.find(
          ({ id }) => id === target.conversationId,
        );
        if (conversation) {
          setActiveConversation(conversation);
          setUserId(currentUser.id);
          setLoggedScreen('Chat');
          return;
        }
      } catch {
        // Sem a conversa, a lista de mensagens continua acessível.
      }
      setLoggedScreen('Messages');
      return;
    }
    if (target.screen === 'Profile') {
      const currentUser = await authApi<Me>('/users/me').catch(() => null);
      if (currentUser) setProfileUserId(currentUser.id);
      setLoggedScreen('Profile');
      return;
    }
    if (target.screen === 'PersonalInfo') setOpenVerificationOnPersonalInfo(false);
    setLoggedScreen(target.screen);
  }

  async function offerRideFromVehicle() {
    if (checkingVehicleOffer) return;
    setCheckingVehicleOffer(true);
    setVehicleOfferError(null);
    setVehicleNeedsVerification(false);
    try {
      const currentUser = await authApi<Me>('/users/me');
      const isAdmin = currentUser.roles?.some(
        ({ role }) => role.name === 'ADMIN',
      );
      if (!isAdmin) {
        const verification = await getIdentityVerificationStatus(authApi);
        if (verification.academic?.status !== 'APPROVED') {
          const isPending =
            verification.academic?.status === 'PENDING_REVIEW';
          const isRejected = verification.academic?.status === 'REJECTED';
          setVehicleNeedsVerification(true);
          setVehicleOfferError(
            isPending
              ? 'Seu comprovante já foi enviado e está em análise pela equipe UniMove. Aguarde a conclusão da revisão; não é necessário enviar o documento novamente.'
              : isRejected
                ? 'Sua validação foi rejeitada. Consulte o motivo e envie um novo comprovante para voltar a oferecer caronas.'
                : 'Para oferecer caronas, envie seu comprovante de matrícula e aguarde a revisão da equipe UniMove.',
          );
          return;
        }
      }
      setLoggedScreen('OfferRide');
    } catch (reason) {
      setVehicleOfferError(
        reason instanceof Error
          ? reason.message
          : 'Tente novamente em instantes.',
      );
    } finally {
      setCheckingVehicleOffer(false);
    }
  }

  function renderScreen() {
    if (loggedScreen === 'Chat' && activeConversation && userId) {
      return (
        <ChatScreen
          conversation={activeConversation}
          userId={userId}
          onBack={() => setLoggedScreen('Messages')}
        />
      );
    }
    if (loggedScreen === 'Messages') {
      return (
        <MessagesScreen
          onBack={back('Home')}
          onOpenConversation={(conversation, currentUserId) => {
            setActiveConversation(conversation);
            setUserId(currentUserId);
            setLoggedScreen('Chat');
          }}
        />
      );
    }
    if (loggedScreen === 'History')
      return <HistoryScreen onBack={back('Home')} />;
    if (loggedScreen === 'SearchRide')
      return <SearchRideScreen onBack={back('Home')} />;
    if (loggedScreen === 'DriverRequests')
      return <RideRequestsScreen mode="driver" onBack={back('Home')} />;
    if (loggedScreen === 'PassengerRequests')
      return <RideRequestsScreen mode="passenger" onBack={back('Home')} />;
    if (loggedScreen === 'NotificationCenter')
      return (
        <NotificationsScreen
          onBack={() => {
            setReturnToNotifications(false);
            setLoggedScreen('Home');
          }}
          onOpenSettings={() => {
            setNotificationSettingsReturn('NotificationCenter');
            setLoggedScreen('Notifications');
          }}
          onOpenTarget={(target) => void openNotificationTarget(target)}
        />
      );
    if (loggedScreen === 'OfferRide')
      return <OfferRideScreen onBack={() => setLoggedScreen('Home')} />;
    if (loggedScreen === 'Profile')
      return (
        <ProfileScreen
          userId={profileUserId}
          onBack={back('Home')}
          onRegisterVehicle={() => {
            setVehicleOfferError(null);
            setVehicleNeedsVerification(false);
            setVehicleReturnScreen('Profile');
            setLoggedScreen('RegisterVehicle');
          }}
        />
      );
    if (loggedScreen === 'RegisterVehicle')
      return (
        <RegisterVehicleScreen
          onBack={() => setLoggedScreen(vehicleReturnScreen)}
          onOfferRide={() => void offerRideFromVehicle()}
          checkingOffer={checkingVehicleOffer}
          offerError={vehicleOfferError}
          needsVerification={vehicleNeedsVerification}
          onVerify={() => {
            setOpenVerificationOnPersonalInfo(true);
            setLoggedScreen('PersonalInfo');
          }}
        />
      );
    if (loggedScreen === 'Settings')
      return (
        <SettingsScreen
          onBack={() => setLoggedScreen('Home')}
          onNavigatePersonalInfo={() => setLoggedScreen('PersonalInfo')}
          onNavigateAdminVerification={() =>
            setLoggedScreen('AdminVerification')
          }
          onNavigateNotifications={() => {
            setNotificationSettingsReturn('Settings');
            setLoggedScreen('Notifications');
          }}
          onNavigatePrivacy={() => setLoggedScreen('Privacy')}
          onNavigateHelp={() => setLoggedScreen('Help')}
        />
      );
    if (loggedScreen === 'Notifications')
      return (
        <NotificationSettingsScreen
          onBack={() => setLoggedScreen(notificationSettingsReturn)}
        />
      );
    if (loggedScreen === 'Privacy')
      return <PrivacyScreen onBack={() => setLoggedScreen('Settings')} />;
    if (loggedScreen === 'Help')
      return <HelpCenterScreen onBack={() => setLoggedScreen('Settings')} />;
    if (loggedScreen === 'PersonalInfo')
      return (
        <PersonalInfoScreen
          openVerificationOnMount={openVerificationOnPersonalInfo}
          onVerificationPromptConsumed={() =>
            setOpenVerificationOnPersonalInfo(false)
          }
          onBack={() => {
            setOpenVerificationOnPersonalInfo(false);
            back('Settings')();
          }}
        />
      );
    if (loggedScreen === 'AdminVerification')
      return (
        <AdminVerificationScreen onBack={() => setLoggedScreen('Settings')} />
      );
    return (
      <HomeScreen
        onNavigateSearch={() => setLoggedScreen('SearchRide')}
        onNavigateOffer={() => setLoggedScreen('OfferRide')}
        onNavigateDriverRequests={() => setLoggedScreen('DriverRequests')}
        onRegisterVehicle={() => {
          setVehicleOfferError(null);
          setVehicleNeedsVerification(false);
          setVehicleReturnScreen('Home');
          setLoggedScreen('RegisterVehicle');
        }}
        onNavigateMessages={() => setLoggedScreen('Messages')}
        onNavigateHistory={() => setLoggedScreen('History')}
        onNavigateProfile={(selectedUserId) => {
          setProfileUserId(selectedUserId);
          setLoggedScreen('Profile');
        }}
        onNavigateSettings={() => setLoggedScreen('Settings')}
        onNavigatePersonalInfo={(openVerification) => {
          setOpenVerificationOnPersonalInfo(openVerification);
          setLoggedScreen('PersonalInfo');
        }}
        onNavigateNotifications={() => {
          setReturnToNotifications(false);
          setLoggedScreen('NotificationCenter');
        }}
      />
    );
  }

  return renderScreen();
}

const styles = StyleSheet.create({
  userLayout: { flex: 1, backgroundColor: colors.primary },
  screen: { flex: 1 },
  profileError: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 16,
    backgroundColor: colors.background,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
