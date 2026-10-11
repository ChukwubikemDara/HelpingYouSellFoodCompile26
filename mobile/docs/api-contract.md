# API Contract v0.6 (UI ↔ Backend)

## Changes from v0.5

Breaking (three):
1. Consumers now have accounts. `X-Device-Id` is gone. Reservation, follow and notification endpoints need `Authorization: Bearer <token>`. Browsing deals needs no sign-in.
2. `POST /reservations` body is `{ deal_id, quantity }`. Name and phone come from the account.
3. `POST /follows` body is `{ merchant_id }`.

Additive:
4. Merchant sign-up and sign-in endpoints (email + password).
5. `GET /deals` takes `sort` and returns `distance_m` when `lat`/`lng` are sent.
6. `Deal.published_at`, `Reservation.unit_price_cents`, `Reservation.customer_id`, `Summary.units_no_show`.
7. A live deal's price can be lowered (never raised).
8. Follows, notifications, merchant suggestions.
9. New error codes: `BAD_CREDENTIALS`, `CUSTOMER_BLOCKED`, `ACCOUNT_EXISTS`.

## Clients and hosting

- Backend + merchant web portal: one Next.js app on AWS. API routes live under `/api` in that app.
- Consumer client: Expo app (run through Expo Go today), calls the same API over HTTPS.
- Merchant endpoints are called only from the web portal (same origin, session cookie).
- Read the API base URL from one config/env value. The deployed URL will be shared when it exists.
- Resize photos to under 1 MB before upload.
- CORS is enabled on the backend for the consumer client.

Changes from here on: additive only, and announced in the team channel with the version number.

## Conventions

- Base URL: `/api`. JSON in, JSON out.
- Money: integer cents (`deal_price_cents: 300` = $3.00).
- Time: ISO 8601 with offset (`2026-10-11T17:30:00-04:00`). `?date=` values are local dates in America/New_York; default is today.
- IDs: strings.
- Phone numbers: E.164 (`+18145550123`). The client converts 10-digit US input before sending.
- Nullable fields are always present with `null`, never omitted.
- Errors: HTTP 4xx/5xx with `{"error": {"code": "SOLD_OUT", "message": "..."}}`
  - 401 `UNAUTHORIZED`, `BAD_CREDENTIALS` · 402 `PLAN_REQUIRED` · 403 `CUSTOMER_BLOCKED` · 404 `NOT_FOUND`, `CODE_INVALID` · 409 `SOLD_OUT`, `DEAL_NOT_LIVE`, `CODE_ALREADY_USED`, `ACCOUNT_EXISTS` · 422 `VALIDATION`
  - `message` is safe to show to the user as is.

## Auth

Customers (mobile app):
- Sign up with name, phone and password. Sign in with phone and password. Both return a token.
- The app stores the token in secure storage and sends `Authorization: Bearer <token>`. The token does not expire today, so the customer stays signed in until they sign out.
- The phone number is not verified by SMS today. It must be unique.

Merchants (web portal):
- Sign up and sign in with email and password. The backend sets an httpOnly session cookie; the portal sends nothing extra.
- Pages `/signin`, `/signup`, `/signout` are owned by the backend. The sign-in method may later be replaced by an external provider without changing any other endpoint.
- Merchant endpoints return 401 `UNAUTHORIZED` without a session.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/customer/signup` | `{ name, phone, password }` | `{ token, customer }` (201) or `ACCOUNT_EXISTS` |
| POST | `/auth/customer/signin` | `{ phone, password }` | `{ token, customer }` or `BAD_CREDENTIALS` |
| GET | `/customers/me` | | Customer |
| POST | `/auth/merchant/signup` | `{ email, password }` | `{ "ok": true }` + cookie, or `ACCOUNT_EXISTS` |
| POST | `/auth/merchant/signin` | `{ email, password }` | `{ "ok": true }` + cookie, or `BAD_CREDENTIALS` |
| POST | `/auth/merchant/signout` | | `{ "ok": true }` |

Passwords: at least 8 characters.

## Objects

### Customer
```json
{
  "id": "c_1",
  "name": "Sam",
  "phone": "+18145550123",
  "no_show_count": 0,
  "blocked": false,                // true once no_show_count reaches 2
  "created_at": "2026-10-11T16:00:00-04:00"
}
```

### Merchant
```json
{
  "id": "m_1",
  "name": "Example Bakery",
  "category": "bakery",            // bakery | cafe | restaurant
  "address": "123 College Ave, State College, PA",
  "lat": 40.7934, "lng": -77.8600,  // both null if not located
  "phone": "+18145550100",
  "closes_at": "18:00",            // local time, today's default
  "default_discount_pct": 50,      // integer 10–90; applied to the regular price unless the merchant states a price
  "menu": [                        // regular items; may be empty. Onboarding asks for about five.
    { "name": "Butter croissant", "price_cents": 400 }
  ],
  "plan_status": "active"          // none | active   (set by billing)
}
```

Location: the portal's onboarding has a "Use my current location" button that sends `lat`/`lng` from the browser. If they are not sent, the backend tries to locate the address and leaves them null if it cannot.

### Deal
```json
{
  "id": "d_1",
  "merchant_id": "m_1",
  "merchant": { "id": "m_1", "name": "Example Bakery", "category": "bakery", "address": "...", "lat": 40.7934, "lng": -77.8600 },
  "title": "Croissants (2-pack)",
  "items": [ { "name": "Butter croissant", "qty": 2 } ],   // contents of ONE unit
  "original_price_cents": 800,
  "deal_price_cents": 400,
  "kind": "surplus",               // surplus | timed  (timed = any-hour, still quantity- and time-limited)
  "quantity_total": 3,
  "quantity_left": 3,
  "max_per_customer": 2,
  "unsold_action": "none",         // none | donated  (set after expiry)
  "pickup_start": "2026-10-11T17:00:00-04:00",
  "pickup_end":   "2026-10-11T18:00:00-04:00",
  "allergens": ["wheat", "milk", "egg"],
  "note": "Baked this morning.",
  "photo_url": null,               // string or null; set by backend when the merchant sent a photo
  "status": "live",                // draft | live | sold_out | expired | cancelled
  "created_at": "2026-10-11T15:02:00-04:00",
  "published_at": "2026-10-11T15:04:00-04:00",   // null while draft
  "distance_m": 420                // integer or null; only set by GET /deals when lat/lng were sent and the merchant has a location
}
```

### Draft (listing assistant output, shown to merchant for approval)

One Draft per product. The deal inside already exists with status `draft`: edit it with `PATCH /deals/{id}`, publish with `POST /deals/{id}/publish`, discard with `POST /deals/{id}/cancel`.
```json
{
  "deal": { /* Deal with status "draft"; allergens is null until the merchant sets it */ },
  "missing_fields": ["allergens"],       // any of: original_price_cents, deal_price_cents, quantity_total, pickup_end, allergens.
                                         // Each is null in deal. UI highlights them; publish is blocked until filled.
  "price_source": "menu",                // stated | menu | history | null: where the regular price came from
  "agent_notes": "Regular price from your menu. Used your default 50% discount.",
  "estimate": {                          // null when quantity or deal price is missing
    "units": 3,
    "deal_price_cents": 400,
    "assumed_sell_through": 0.6,         // ASSUMPTION, label it as such in UI
    "expected_recovered_cents": 720,
    "if_discarded_cents": 0
  }
}
```

### Reservation
```json
{
  "id": "r_1",
  "deal_id": "d_1",
  "deal": { /* Deal */ },
  "customer_id": "c_1",
  "customer_name": "Sam",
  "customer_phone": "+18145550123",
  "quantity": 1,
  "unit_price_cents": 400,          // deal price at the moment of reserving; later price drops do not change it
  "total_cents": 400,               // quantity × unit_price_cents, paid in store
  "payment_method": "in_store",     // in_store for now; do not hardcode in UI
  "pickup_code": "4821",
  "status": "reserved",             // reserved | picked_up | cancelled | no_show
  "created_at": "2026-10-11T16:10:00-04:00"
}
```

### Notification
```json
{
  "id": "n_1",
  "type": "new_deal",               // new_deal | deal_cancelled | pickup_reminder
  "title": "Example Bakery",
  "body": "Croissants (2-pack) for $4.00, pickup until 6:00 PM",
  "deal_id": "d_1",                 // or null
  "reservation_id": null,           // or string
  "read": false,
  "created_at": "2026-10-11T15:04:00-04:00"
}
```

### Suggestion (merchant side)
```json
{
  "id": "s_1",
  "type": "lower_price",            // list_now | lower_price
  "deal_id": "d_1",                 // null for list_now
  "message": "1 of 3 reserved, 30 minutes left. Lower Croissants (2-pack) to $3.00?",
  "proposed": { "deal_price_cents": 300 },   // null for list_now
  "basis": { "reserved": 1, "total": 3, "minutes_left": 30 }   // the numbers behind the message
}
```

### Summary
```json
{
  "date": "2026-10-11",
  "units_listed": 9,
  "units_picked_up": 5,
  "units_no_show": 0,
  "units_unsold": 4,
  "recovered_cents": 2000,
  "platform_fee_cents": 495,
  "if_discarded_cents": 0
}
```

## Consumer endpoints

No sign-in needed:

| Method | Path | Query | Returns |
|---|---|---|---|
| GET | `/deals` | `?category=&kind=&lat=&lng=&sort=` all optional. `sort` = `ending` (default) or `distance` (needs lat/lng; deals with no location go last) | `{ "deals": [Deal] }` `live` and `sold_out` only |
| GET | `/deals/{id}` | | Deal |

Signed-in customer (`Authorization: Bearer`):

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| POST | `/reservations` | `{ deal_id, quantity }` | Reservation (201), or `SOLD_OUT`, `DEAL_NOT_LIVE`, `CUSTOMER_BLOCKED` |
| GET | `/reservations` | | `{ "reservations": [Reservation] }` newest first |
| GET | `/reservations/{id}` | | Reservation |
| POST | `/reservations/{id}/cancel` | | Reservation |
| POST | `/reservations/{id}/confirm-pickup` | | Reservation (`picked_up`) |
| GET | `/follows` | | `{ "merchant_ids": ["m_1"] }` |
| POST | `/follows` | `{ merchant_id }` | `{ "ok": true }` |
| DELETE | `/follows/{merchant_id}` | | `{ "ok": true }` |
| GET | `/notifications` | `?since=<ISO time>` optional | `{ "notifications": [Notification] }` newest first |
| POST | `/notifications/{id}/read` | | `{ "ok": true }` |
| POST | `/customers/me/push-token` | `{ expo_push_token }` | `{ "ok": true }` optional; see Notifications |

Reservation endpoints return 404 unless the reservation belongs to the signed-in customer.

## Merchant endpoints (session cookie)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/me` | | `{ "merchant": Merchant \| null }` null = signed in but not onboarded yet |
| POST | `/merchants` | `{ name, category, address, phone, closes_at, default_discount_pct, menu, lat?, lng? }` | Merchant (201) |
| PATCH | `/merchants/{id}` | any of the fields above | Merchant |
| GET | `/merchants/{id}` | | Merchant |
| POST | `/merchants/{id}/drafts` | `{ text?: string, photo_base64?: string }` at least one | `{ "drafts": [Draft] }` one per product, may be empty (takes 2–10 s, show a spinner) |
| POST | `/deals` | Deal fields without `id`/`status` | Deal (`draft`) manual entry |
| PATCH | `/deals/{id}` | `draft`: title, items, prices, kind, quantity_total, max_per_customer, pickup_start, pickup_end, allergens, note. `live`: quantity_total, pickup_end, note, and `deal_price_cents` (lower only) | Deal |
| POST | `/deals/{id}/publish` | | Deal (`live`) or `VALIDATION` / `PLAN_REQUIRED` |
| POST | `/deals/{id}/cancel` | | Deal |
| POST | `/deals/{id}/mark-donated` | | Deal (`unsold_action: "donated"`) only when `expired` with units left |
| GET | `/merchants/{id}/deals` | `?date=` | `{ "deals": [Deal] }` all statuses |
| GET | `/merchants/{id}/reservations` | `?date=` | `{ "reservations": [Reservation] }` |
| POST | `/reservations/redeem` | `{ pickup_code }` | Reservation (`picked_up`), or `CODE_INVALID` / `CODE_ALREADY_USED` |
| GET | `/merchants/{id}/summary` | `?date=` | Summary |
| GET | `/merchants/{id}/suggestions` | | `{ "suggestions": [Suggestion] }` |
| POST | `/suggestions/{id}/accept` | | Deal for `lower_price`; `{ "ok": true }` for `list_now` |
| POST | `/suggestions/{id}/dismiss` | | `{ "ok": true }` |

`{id}` in `/merchants/{id}/...` must be the signed-in merchant's id; anything else returns 404.

## Relations, state transitions, rules

Relations: Merchant 1—N Deal 1—N Reservation N—1 Customer. Customer N—N Merchant through Follow. Customer 1—N Notification.

Deal status:
- `draft` → `live` on publish (sets `published_at`)
- `live` → `sold_out` when `quantity_left` hits 0; back to `live` if a cancel frees a unit
- `live` / `sold_out` → `expired` at `pickup_end` (derived by the backend)
- `draft` / `live` / `sold_out` → `cancelled` by merchant (open reservations become `cancelled`)

Reservation status:
- `reserved` → `picked_up` by merchant redeem OR customer confirm-pickup (either one is enough)
- `reserved` → `cancelled` by customer, only before `pickup_end`; units go back to `quantity_left`
- `reserved` → `no_show` at `pickup_end` + 15 min (derived by the backend); adds 1 to the customer's `no_show_count`

Timing: a deal can be reserved from the moment it is `live` until `pickup_end`. It can be picked up only between `pickup_start` and `pickup_end`; redeem and confirm-pickup outside that window return `VALIDATION`.

Discounts: the merchant's `default_discount_pct` is only a starting value. The price is set per deal, so it can differ per product and per day.

Rules the backend enforces (UI should mirror in forms):
- `deal_price_cents` < `original_price_cents`; `quantity_total` ≥ 1; `pickup_end` > now and > `pickup_start`
- `quantity_total` on a live deal cannot go below the number already reserved
- `deal_price_cents` on a live deal can only go down. Existing reservations keep their `unit_price_cents`
- `allergens` must be set by the merchant before publish. `null` = not answered (blocks publish), `[]` = none
- Reserve: `quantity` ≤ `quantity_left` and ≤ `max_per_customer` per customer per deal
- A customer with `blocked: true` cannot reserve (`CUSTOMER_BLOCKED`)
- `pickup_code` is 4 digits, unique among a merchant's open reservations; redeem is scoped to the signed-in merchant
- Platform fee counts only `picked_up` reservations

## Notifications

The backend creates notifications; the app fetches them.

| Type | Created when | Goes to |
|---|---|---|
| `new_deal` | a deal goes live | customers who follow that merchant |
| `deal_cancelled` | a merchant cancels a deal | customers with an open reservation on it |
| `pickup_reminder` | 30 min before `pickup_end` | customers with a `reserved` reservation on it |

- The app calls `GET /notifications` on focus and every 30 s, shows an in-app list with an unread count, and raises a local notification for each new one.
- Remote push through `expo_push_token` is optional and off unless the backend says otherwise. The polling path must work without it.

## Suggestions (merchant)

Fixed rules on live data. No model, no forecast.

| Type | Shown when | Accepting does |
|---|---|---|
| `list_now` | within 2 h before `closes_at` and the merchant has created no deal today | nothing on the server; the portal opens the new-listing screen |
| `lower_price` | deal is `live`, at least half the time from `published_at` to `pickup_end` has passed, fewer than half the units are reserved, and its price has not been lowered by a suggestion before | sets `deal_price_cents` to the proposed price |

Proposed price = current deal price × 0.8, rounded down to a multiple of 25 cents, minimum 25 cents. Dismissed suggestions do not come back for that deal or that day.

## Billing (owned by backend; UI only links out)

- Merchant plan checkout, pricing page and billing portal are generated by AWS App Monetization. UI needs only two links from `GET /billing/links` → `{ "pricing_url": "...", "portal_url": "..." }`.
- `plan_status` on Merchant tells the UI whether to show "Choose a plan" before publishing. Publish returns `PLAN_REQUIRED` only when the backend has the plan gate switched on; handle the error either way.
- Backend records one usage event per `picked_up` reservation.
- Card payments for the merchant plan run in test mode during the hackathon. The consumer pays the merchant in store; the API does not take consumer payments.

## Screens this covers

Consumer: sign up / sign in → deal list (list and map, sort by distance or ending soon) → deal detail (follow store) → reserve → reservation with pickup code → my reservations → notifications.
Merchant: sign up / sign in → onboarding → today (suggestions, deals, reservations, enter code) → new listing (text + photo) → draft review/approve → manual listing → summary.

UI notes: the consumer deal list and an open reservation refresh on focus and every 30 s. The merchant today screen polls every 10 s. Disable a button while its request is in flight.

## Mock data

Until the backend is up, UI uses the example objects above as fixtures. Backend serves the same shapes.
