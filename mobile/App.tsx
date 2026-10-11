import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { StatusBar } from 'expo-status-bar'
import { Pressable, Text } from 'react-native'
import { colors } from './src/components/ui'
import type { RootStackParamList } from './src/navigation'
import { DealDetail } from './src/screens/DealDetail'
import { DealList } from './src/screens/DealList'
import { MyReservations } from './src/screens/MyReservations'
import { ReservationScreen } from './src/screens/ReservationScreen'

const Stack = createNativeStackNavigator<RootStackParamList>()

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen
          name="Deals"
          component={DealList}
          options={({ navigation }) => ({
            title: "Tonight's deals",
            headerRight: () => (
              <Pressable onPress={() => navigation.navigate('MyReservations')} accessibilityRole="button" hitSlop={8}>
                <Text style={{ color: colors.primaryDark, fontWeight: '600', fontSize: 16 }}>My pickups</Text>
              </Pressable>
            ),
          })}
        />
        <Stack.Screen name="Deal" component={DealDetail} options={{ title: '' }} />
        <Stack.Screen name="Reservation" component={ReservationScreen} options={{ title: 'Your pickup' }} />
        <Stack.Screen name="MyReservations" component={MyReservations} options={{ title: 'My pickups' }} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}
