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
import { OfferRideScreen } from './src/screens/OfferRideScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { RegisterVehicleScreen } from './src/screens/RegisterVehicleScreen';
import type { Conversation } from './src/api/messages';
import { colors } from './src/theme';
import { AdvertisementBar } from './src/components/AdvertisementBar';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { CompleteProfileScreen } from './src/screens/CompleteProfileScreen';
import { getMyProfile, type Profile } from './src/services/profileService';
import { Button } from './src/components/Button';
import { Message } from './src/components/Message';

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
  const [loggedScreen, setLoggedScreen] = useState<
    | 'Home'
    | 'SearchRide'
    | 'OfferRide'
    | 'Messages'
    | 'Chat'
    | 'Profile'
    | 'RegisterVehicle'
    | 'History'
  >('Home');
  const [activeConversation, setActiveConversation] =
    useState<Conversation | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [profileUserId, setProfileUserId] = useState<string>('');

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
          onBack={() => setLoggedScreen('Home')}
          onOpenConversation={(conversation, currentUserId) => {
            setActiveConversation(conversation);
            setUserId(currentUserId);
            setLoggedScreen('Chat');
          }}
        />
      );
    }
    if (loggedScreen === 'History')
      return <HistoryScreen onBack={() => setLoggedScreen('Home')} />;
    if (loggedScreen === 'SearchRide')
      return <SearchRideScreen onBack={() => setLoggedScreen('Home')} />;
    if (loggedScreen === 'OfferRide')
      return <OfferRideScreen onBack={() => setLoggedScreen('Home')} />;
    if (loggedScreen === 'Profile')
      return (
        <ProfileScreen
          userId={profileUserId}
          onBack={() => setLoggedScreen('Home')}
          onRegisterVehicle={() => setLoggedScreen('RegisterVehicle')}
        />
      );
    if (loggedScreen === 'RegisterVehicle')
      return (
        <RegisterVehicleScreen
          onBack={() => setLoggedScreen('Profile')}
          onOfferRide={() => setLoggedScreen('OfferRide')}
        />
      );
    return (
      <HomeScreen
        onNavigateSearch={() => setLoggedScreen('SearchRide')}
        onNavigateOffer={() => setLoggedScreen('OfferRide')}
        onNavigateMessages={() => setLoggedScreen('Messages')}
        onNavigateHistory={() => setLoggedScreen('History')}
        onNavigateProfile={(selectedUserId) => {
          setProfileUserId(selectedUserId);
          setLoggedScreen('Profile');
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
