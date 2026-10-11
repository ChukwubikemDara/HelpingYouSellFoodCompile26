import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs'
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'

export type TabParamList = {
  Deals: undefined
  Pickups: undefined
  Profile: undefined
}

// Deal and Reservation sit above the tabs so they cover the tab bar.
export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined
  Deal: { id: string }
  Reservation: { id: string }
}

export type StackProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>

export type TabProps<T extends keyof TabParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>
