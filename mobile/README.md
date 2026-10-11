# Mobile app (consumer)

Expo app for students: browse deals from local food businesses, reserve, pick up and pay in store.
It runs in **Expo Go** (Expo SDK 57). There is no app store build.

- API contract: `docs/api-contract.md` (v0.6). UI rules: `docs/design.md`.
- All API calls are in `src/lib/api.ts`. Sample data for offline use is in `src/lib/fixtures.ts`.

## For testers: open the app on your phone

1. Install **Expo Go** from the App Store (iPhone) or Google Play (Android). Update it if it is already installed: the app needs the current Expo Go (SDK 57).
2. Get the QR code from the developer running the app (it is printed in their terminal).
3. Open the app:
   - iPhone: open the Camera app, point it at the QR code and tap the banner that appears.
   - Android: open Expo Go, tap **Scan QR code**, and scan it.
4. The first load takes up to a minute. After that, shake the phone to open the Expo menu if you need to reload.
5. When asked, allow location (deals are then sorted by distance) and notifications (you get one when a store you follow lists a deal). Both are optional: without location the list is sorted by ending soon and the map starts at downtown State College.

You can browse deals without an account. Reserving, following a store and notifications ask you to sign in or create an account (name, US phone number, password of at least 8 characters). You stay signed in after closing the app until you sign out on the Account tab.

If the Account tab says "Showing sample data", the app is not connected to the live service. In that mode:
- the deal list has one example deal, and nothing you do is sent anywhere;
- your account is kept when the app reloads, but reservations reset;
- the example customer can sign in with phone `(814) 555-0123` and password `password`.

## For developers

Requirements: Node 22 and npm. On WSL use the Linux Node (for example through nvm), not the Windows one.

```bash
npm install
```

### Set the API URL

The app reads its configuration from environment variables that Expo inlines when it bundles the app. Put them in a `.env` file in the repo root (ignored by git) or set them in the shell:

```bash
# .env
EXPO_PUBLIC_API_URL=https://your-deployed-host.example.com/api
```

| Variable | Purpose | Example | Required |
|---|---|---|---|
| `EXPO_PUBLIC_API_URL` | API base URL, **including** the `/api` prefix. Must be public HTTPS: a phone cannot reach `localhost`. | `https://example.com/api` | optional (without it the app uses sample data) |
| `EXPO_PUBLIC_USE_FIXTURES` | `1` forces sample data even when `EXPO_PUBLIC_API_URL` is set. | `1` | optional |

Fixture mode is on when `EXPO_PUBLIC_USE_FIXTURES=1` **or** `EXPO_PUBLIC_API_URL` is unset or empty. Switching to the live API is only a config change.

After changing a variable, restart with a clean cache so the new value is bundled:

```bash
npx expo start --tunnel --port 8081 --clear
```

### Start

```bash
npm start          # expo start --tunnel --port 8081
```

This prints a QR code and an `exp://….exp.direct` URL. Testers scan the QR code as described above. Press `r` in the terminal to reload all connected phones, `Ctrl+C` to stop.

**WSL2:** use `npm start` (the tunnel). The WSL network address is not reachable from a phone, so LAN mode does not work there. The tunnel uses `@expo/ngrok` (installed as a dev dependency) and needs no account. You may see "An unknown error occurred while installing React Native DevTools … libnspr4.so" on WSL; it only affects the desktop debugger and can be ignored.

On a Mac or Linux machine on the same Wi-Fi as the phone, `npm run start:lan` is faster.

### Checks

```bash
npm run typecheck                                   # tsc --noEmit
npx expo export --platform android --output-dir /tmp/expo-export   # confirms the app bundles
```

### Expo Go notes

- Map: `react-native-maps` (Apple Maps on iOS, Google Maps on Android; no API key needed in Expo Go).
- Location: `expo-location`, foreground permission only.
- Notifications: the app polls `GET /notifications` on focus and every 30 s and raises a **local** notification with `expo-notifications` for each new item. Remote push is not used: it is unavailable in Expo Go on Android since SDK 53, and the contract makes it optional.
  In Expo Go on **Android**, `expo-notifications` cannot be loaded at all (it throws on import), so there the app shows new items only in the in-app Notifications tab with its unread count; system notifications appear on iPhone (Expo Go) and in development builds.
- Session: the customer token is stored with `expo-secure-store`.

### Layout

```
src/app/                 screens (Expo Router)
  (tabs)/index.tsx       deals: list and map
  (tabs)/reservations.tsx
  (tabs)/notifications.tsx
  (tabs)/account.tsx     sign in / sign out
  deal/[id].tsx          deal detail, follow store
  reserve/[dealId].tsx   choose quantity, reserve
  reservation/[id].tsx   pickup code, "I picked it up", cancel
  signin.tsx, signup.tsx
src/lib/api.ts           every API call, types, error handling, fixture switch
src/lib/fixtures.ts      contract example objects + in-memory store
src/lib/auth.tsx         session (secure storage)
src/lib/notifications.tsx polling and local notifications
src/components/          UI pieces following docs/design.md
```
