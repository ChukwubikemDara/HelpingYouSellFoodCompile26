# [NAME] mobile (consumer app)

Consumer app for a marketplace where local food businesses list a limited quantity of items for a limited time at a discount. Students browse deals, reserve, and pick up and pay in store. Built in one day at a hackathon; a live demo is at 8:00 PM today.

Expo app, run through Expo Go on real phones today. It calls the API in the web repo.

## Read before writing code

- `docs/api-contract.md`: source of truth for endpoints and object shapes. It is frozen. Use the "Consumer endpoints" section; merchant endpoints are not called from this app.
- `docs/design.md`: UI rules.

If the docs do not cover something you need, stop and ask. Do not pick a default silently.

## Rules

- API base URL comes from one config value (`EXPO_PUBLIC_API_URL`). No hardcoded hosts.
- Customers have accounts (name, phone, password). Keep the token in secure storage and send it as a bearer token. The session survives closing the app. Browsing deals works signed out; reserving, following and notifications require sign-in.
- Until the API is deployed, read from fixtures that match the contract's example objects exactly. Switching to the live API is a config change, not a rewrite.
- Money arrives as integer cents; format for display only. Times arrive as ISO 8601 with offset; show them in the device's local time.
- Nullable fields (`lat`, `lng`, `photo_url`, `distance_m`) must not break a screen. Denied location permission must not break the deal list.
- No payments in the app. The reservation screen says the customer pays in store.
- Must work in Expo Go: no custom native modules.
- UI copy never says "leftover", "expiring", "waste" or "about to be thrown out".
- Code, comments, UI copy and commit messages are in English.

## Screens

1. Sign up / sign in
2. Deals: list and map, sorted by distance or ending soon
3. Deal detail, with follow store
4. Reserve (quantity)
5. Reservation with pickup code, "I picked it up", cancel
6. My reservations
7. Notifications

Out unless asked: payments, search, reviews, remote push that needs a custom build.

## Working agreement

- Small commits. Type-check before committing.
- When a task is done, report what was built, what was not, and anything in the docs that turned out ambiguous.
