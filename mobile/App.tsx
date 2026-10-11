import { Ionicons } from '@expo/vector-icons'
import { DMMono_500Medium } from '@expo-google-fonts/dm-mono/500Medium'
import { DMSans_400Regular } from '@expo-google-fonts/dm-sans/400Regular'
import { DMSans_500Medium } from '@expo-google-fonts/dm-sans/500Medium'
import { DMSans_700Bold } from '@expo-google-fonts/dm-sans/700Bold'
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces/600SemiBold'
import { Fraunces_600SemiBold_Italic } from '@expo-google-fonts/fraunces/600SemiBold_Italic'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { DefaultTheme, NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useFonts } from 'expo-font'
import { StatusBar } from 'expo-status-bar'
import { View } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import type { IoniconName } from './src/components/ui'
import type { RootStackParamList, TabParamList } from './src/navigation'
import { ProfileProvider, useProfile } from './src/profile'
import { DealDetail } from './src/screens/DealDetail'
import { DealList } from './src/screens/DealList'
import { Pickups } from './src/screens/Pickups'
import { Profile } from './src/screens/Profile'
import { ReservationScreen } from './src/screens/ReservationScreen'
import { Welcome } from './src/screens/Welcome'
import { colors, fonts } from './src/theme'

const Stack = createNativeStackNavigator<RootStackParamList>()
const Tab = createBottomTabNavigator<TabParamList>()

const TAB_ICONS: Record<keyof TabParamList, [active: IoniconName, idle: IoniconName]> = {
  Deals: ['pricetag', 'pricetag-outline'],
  Pickups: ['ticket', 'ticket-outline'],
  Profile: ['person', 'person-outline'],
}

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.paper, card: colors.card, border: colors.line, primary: colors.ember },
}

function Tabs() {
  const insets = useSafeAreaInsets()
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.ember,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: fonts.bold, fontSize: 11 },
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.line,
          height: 62 + insets.bottom,
          paddingTop: 6,
        },
        tabBarIcon: ({ focused, color, size }) => (
          <Ionicons name={TAB_ICONS[route.name][focused ? 0 : 1]} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Deals" component={DealList} />
      <Tab.Screen name="Pickups" component={Pickups} />
      <Tab.Screen name="Profile" component={Profile} />
    </Tab.Navigator>
  )
}

function Root() {
  const { profile, ready } = useProfile()
  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_600SemiBold_Italic,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
    DMMono_500Medium,
  })

  // hold a blank paper screen for the split second it takes to read fonts and the saved profile
  if (!ready || !fontsLoaded) return <View style={{ flex: 1, backgroundColor: colors.paper }} />

  if (!profile.onboarded) {
    return (
      <>
        <StatusBar style="light" />
        <Welcome />
      </>
    )
  }

  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style="dark" />
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
        <Stack.Screen name="Tabs" component={Tabs} />
        <Stack.Screen name="Deal" component={DealDetail} />
        <Stack.Screen name="Reservation" component={ReservationScreen} options={{ presentation: 'modal' }} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ProfileProvider>
        <Root />
      </ProfileProvider>
    </SafeAreaProvider>
  )
}
