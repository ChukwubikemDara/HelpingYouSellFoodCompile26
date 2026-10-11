# mobile

Consumer app (Expo): browse deals, reserve, show the pickup code, my pickups.
The merchant portal lives in `../web`.

## Run it on your phone

1. Install **Expo Go** from the App Store / Play Store.
2. On the laptop:

   ```bash
   npm install
   npx expo start
   ```

3. Scan the QR code (iPhone: Camera app, Android: inside Expo Go). Phone and
   laptop need to be on the same Wi-Fi. If it won't connect (campus Wi-Fi often
   blocks it), use `npx expo start --tunnel`.

Quick look without a phone: `npx expo start --web`.

## Mock vs real backend

`.env` sets `EXPO_PUBLIC_API_MOCK=1`, so the app serves fixtures from
`src/mock.ts` and keeps them on the device. The mock is separate from the web
portal's mock, so a reservation made here won't show up there.

For the real API set `EXPO_PUBLIC_API_MOCK=0` and `EXPO_PUBLIC_API_URL` to the
backend's address. A phone can't reach the laptop as `localhost`: use the
laptop's LAN IP (e.g. `http://192.168.1.20:8000`) or the deployed URL. Restart
`expo start` after changing `.env`.

## Store portal link

The Profile tab shows an "I run a store" row that opens the web portal in an
in-app browser when `EXPO_PUBLIC_PORTAL_URL` is set. Deployed: put the portal's
URL in `.env`. Demo off a laptop: start the portal with `npm run dev -- --host`
in `../web`, and put `EXPO_PUBLIC_PORTAL_URL=http://<laptop-ip>:5173` in
`.env.local`. Restart `expo start` after changing either file.

`src/types.ts`, `src/format.ts`, `src/hooks.ts` and `src/mock.ts` mirror the
files in `../web/src`. Keep them in step when the contract changes.
