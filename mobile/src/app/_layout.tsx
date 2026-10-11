import { DMMono_500Medium } from '@expo-google-fonts/dm-mono/500Medium';
import { DMSans_400Regular } from '@expo-google-fonts/dm-sans/400Regular';
import { DMSans_500Medium } from '@expo-google-fonts/dm-sans/500Medium';
import { DMSans_600SemiBold } from '@expo-google-fonts/dm-sans/600SemiBold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { LogBox } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { font, setFontsAvailable } from '@/components/ui';
import { useWelcomeSeen, Welcome } from '@/components/Welcome';
import { AuthProvider, useAuth } from '@/lib/auth';
import { NotificationsProvider } from '@/lib/notifications';
import { colors } from '@/lib/theme';

void SplashScreen.preventAutoHideAsync().catch(() => {});

// Whatever the first URL is (a deep link, a screen reopened after a reload), the tabs stay
// underneath so back always has somewhere to go.
export const unstable_settings = { initialRouteName: '(tabs)' };

// expo-notifications warns on import in Expo Go because remote push is not available there.
// This app only raises local notifications (which work in Expo Go), so hide that warning from testers.
LogBox.ignoreLogs(['`expo-notifications` functionality is not fully supported in Expo Go']);

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMMono_500Medium,
  });
  if (!fontsLoaded && !fontError) return null;
  // If the fonts fail to load in Expo Go, fall back to the system font rather than block the app.
  setFontsAvailable(fontsLoaded);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppStack />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function AppStack() {
  const { ready } = useAuth();
  const [welcomeSeen, markWelcomeSeen] = useWelcomeSeen();
  const loaded = ready && welcomeSeen !== null;

  useEffect(() => {
    if (loaded) void SplashScreen.hideAsync().catch(() => {});
  }, [loaded]);

  if (!loaded) return null;

  return (
    <NotificationsProvider>
      <StatusBar style="dark" />
      {/* Every screen draws its own top bar in the Last Call style. */}
      <Stack
        screenOptions={{
          headerShown: false,
          headerStyle: { backgroundColor: colors.paper },
          headerTintColor: colors.ink,
          headerTitleStyle: { ...font('bold'), fontSize: 16, color: colors.ink },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.paper },
          animation: 'slide_from_right',
        }}>
        <Stack.Screen name="(tabs)" options={{ title: 'Deals', animation: 'fade' }} />
        <Stack.Screen name="deal/[id]" options={{ title: 'Deal' }} />
        <Stack.Screen name="reserve/[dealId]" options={{ title: 'Reserve' }} />
        <Stack.Screen name="reservation/[id]" options={{ title: 'Reservation' }} />
        {/* Sign in and sign up rise from the bottom like a sheet. Switching between them happens inside the form. */}
        <Stack.Screen name="signin" options={{ title: 'Sign in', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="signup" options={{ title: 'Create account', animation: 'slide_from_bottom' }} />
        {/* Store mode is the merchant portal full screen. No swipe-back: the portal has its own back gestures. */}
        <Stack.Screen name="store-mode" options={{ title: 'Store mode', animation: 'slide_from_bottom', gestureEnabled: false }} />
      </Stack>
      {/* Drawn over the stack (not instead of it) so the router stays mounted underneath. */}
      {welcomeSeen ? null : <Welcome onDone={markWelcomeSeen} />}
    </NotificationsProvider>
  );
}
