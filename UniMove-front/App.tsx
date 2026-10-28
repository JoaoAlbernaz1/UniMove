import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { HomeScreen } from './src/screens/HomeScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { MessagesScreen } from './src/screens/MessagesScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { RegisterScreen } from './src/screens/RegisterScreen';
import { SearchRideScreen } from './src/screens/SearchRideScreen';
import { OfferRideScreen } from './src/screens/OfferRideScreen';
import type { Conversation } from './src/api/messages';
import { colors } from './src/theme';
import { AdvertisementBar } from './src/components/AdvertisementBar';

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
  return status === 'signedIn' ? <SignedInApp /> : <SignedOutApp />;
}

function SignedOutApp() {
  const [registering, setRegistering] = useState(false);
  return registering ? (
    <RegisterScreen onBack={() => setRegistering(false)} />
  ) : (
    <LoginScreen onRegister={() => setRegistering(true)} />
  );
}

function SignedInApp() {
  const [loggedScreen, setLoggedScreen] = useState<
    'Home' | 'SearchRide' | 'OfferRide' | 'Messages' | 'Chat'
  >('Home');
  const [activeConversation, setActiveConversation] =
    useState<Conversation | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

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
    if (loggedScreen === 'SearchRide')
      return <SearchRideScreen onBack={() => setLoggedScreen('Home')} />;
    if (loggedScreen === 'OfferRide')
      return <OfferRideScreen onBack={() => setLoggedScreen('Home')} />;
    return (
      <HomeScreen
        onNavigateSearch={() => setLoggedScreen('SearchRide')}
        onNavigateOffer={() => setLoggedScreen('OfferRide')}
        onNavigateMessages={() => setLoggedScreen('Messages')}
      />
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.userLayout}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.screen}>{renderScreen()}</View>
      <AdvertisementBar />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  userLayout: { flex: 1, backgroundColor: colors.primary },
  screen: { flex: 1 },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
