import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { HomeScreen } from './src/screens/HomeScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { MessagesScreen } from './src/screens/MessagesScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { RegisterScreen } from './src/screens/RegisterScreen';
import { SearchRideScreen } from './src/screens/SearchRideScreen';
import type { Conversation } from './src/api/messages';
import { colors } from './src/theme';

export default function App() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_700Bold });
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
  const [registering, setRegistering] = useState(false);
  
  // Novo estado que respeita a sua estrutura de rotas para a área logada
  const [loggedScreen, setLoggedScreen] = useState<'Home' | 'SearchRide' | 'Messages' | 'Chat'>('Home');
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Quem sai da conta volta para o login, não para o cadastro.
  useEffect(() => {
    if (status === 'signedIn') {
      setRegistering(false);
      setLoggedScreen('Home'); // Garante que volta pra Home ao fazer login
    }
  }, [status]);

  if (status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  
  // Renderização condicional da área logada
  if (status === 'signedIn') {
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
    if (loggedScreen === 'SearchRide') {
      return <SearchRideScreen onBack={() => setLoggedScreen('Home')} />;
    }
    return (
      <HomeScreen
        onNavigateSearch={() => setLoggedScreen('SearchRide')}
        onNavigateMessages={() => setLoggedScreen('Messages')}
      />
    );
  }
  
  return registering ? (
    <RegisterScreen onBack={() => setRegistering(false)} />
  ) : (
    <LoginScreen onRegister={() => setRegistering(true)} />
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
