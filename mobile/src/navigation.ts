import type { NativeStackScreenProps } from '@react-navigation/native-stack'

export type RootStackParamList = {
  Deals: undefined
  Deal: { id: string }
  Reservation: { id: string }
  MyReservations: undefined
}

export type ScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>
