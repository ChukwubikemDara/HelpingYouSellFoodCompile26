# Your local dev-david copy

Lakshay's remote branch (c83a108, latest fetched update) was copied into mobile/ and web/. Its commits and main have not been modified or pushed. Your copy now uses the backend's shared v0.6 types and real endpoints. Mock data is not active; the older mock.ts files are preserved as reference and excluded from compilation.

## Open the web app

From a terminal:

```sh
cd /Users/thehomefolder/Documents/GitHub/HelpingYouSellFoodCompile26
./run-local.sh
```

Open http://localhost:3000 . Business sign-in: demo@lastcall.local / DemoFood26! . Customer sign-in: +18145550123 / DemoFood26! . These are disposable local demo accounts, not cloud accounts. Use New deal → Manual listing to create your own deal. The updated website is merchant-only. Use the Expo mobile app to browse, sign in as a customer, reserve, and confirm pickup; enter pickup codes in the business dashboard. Summary uses actual picked-up reservations and immutable booked prices.

The launcher installs pinned dependencies, starts DynamoDB Local, creates four local tables, seeds demo accounts, builds the React UI and serves it from the Next.js backend. It overrides database/credential configuration with dummy local values. It does not provision AWS. Java and Node 22+ are required; this laptop already has Java. If Node/pnpm are not on PATH, the launcher uses this laptop's bundled Codex runtimes. On another machine install Node and pnpm normally.

Keep this terminal open. Ctrl+C stops both servers. Data persists under .local/dynamodb/data and survives restarts. The local database uses port 8126; the app uses 3000. Stop another server on those ports before running. The app binds to the laptop network so Expo Go can reach it. Local HTTP cookies are supported only with the launcher's LOCAL_DEVELOPMENT=1; deployed production must use HTTPS with that override unset.

## Run Expo Go

In a second terminal, from the same repository:

```sh
./run-mobile.sh
```

It installs mobile dependencies and picks your laptop's LAN address for the API. Scan the QR code using Expo Go. Phone and laptop must be on the same Wi-Fi; if the selected address is wrong, override it:

```sh
EXPO_PUBLIC_API_URL=http://YOUR_LAPTOP_IP:3000 ./run-mobile.sh
```

Browse deals anonymously. Open Profile to sign in or create an account; reservation name/phone come from the account. Native tokens use Expo SecureStore. A web preview uses sessionStorage instead. Sign-out revokes the server token. No device-ID or phone-query authentication remains.

## Change code

For hot reloading: keep DynamoDB Local running, stop the launcher's app server, start the backend with the local variables listed in backend/.env.example (copy them into an ignored .env.local), then run pnpm dev in backend/ and pnpm dev in web/. Vite proxies /api to port 3000. For the simplest verified path, edit source, stop run-local.sh, and run it again; it rebuilds the UI and backend.

## Changes and remaining scope

- Customer account signup/signin, bearer sessions and server-side password hashing.
- Merchant account signup/signin, httpOnly sessions, ownership checks, same-origin CSRF checks and signout.
- v0.6 field names/types, menu, nullable locations/draft fields, manual POST /deals and wrapped draft response parsing.
- Create/edit/publish/cancel deals; price reductions and immutable reservation prices.
- Reservations, pickup/cancellation, no-show reconciliation on API requests, donated marking and merchant summary.
- Web and merchant portal served from the same Next.js origin; original Vite source/style preserved.

Listing assistant is not connected; its route returns a clear unavailable error and the manual form works. Billing links/usage delivery are not connected; plan gate is off and the local fee is zero. Follows, notifications, suggestions and address geocoding remain future integrations. No location is invented when omitted. Do not present this as all of v0.6 or a deployed product. The in-process maintenance and paginated full-table reads target a small local hackathon demo, not a large production marketplace.

## Verification

All 14 backend tests passed against DynamoDB Local, including the authenticated API lifecycle and concurrent inventory races. Web/Next production builds and mobile TypeScript checks passed. Expo bundle export is checked separately; physical-phone behavior still needs a run through Expo Go. Integration tests require local DynamoDB:

```sh
cd backend
DYNAMODB_TEST_ENDPOINT=http://127.0.0.1:8126 pnpm test
```
