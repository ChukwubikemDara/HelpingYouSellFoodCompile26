# Architecture

One Next.js 15 app (App Router, TypeScript strict): the JSON API under `/api` and the merchant portal. The consumer Expo app calls the same API over HTTPS. `docs/api-contract.md` (v0.6) is the source of truth for shapes and rules; this file describes how the code is organized around it, for the teammate integrating AWS.

Keep this file current when a module's interface or an environment variable changes (CLAUDE.md). Deploy steps: `docs/DEPLOY.md`. AWS resources and the DynamoDB layout: `docs/AWS.md`.

Status at a glance (what is real, what is a stub):

| Part | Status |
|---|---|
| Every contract v0.6 endpoint | Implemented (`app/api/**`, `lib/services/**`) |
| Data | `memory` driver (tests, local dev; one process only) and `dynamodb` driver (single table, transactions). Production defaults to `dynamodb`. |
| Sign-in | Our own accounts in the store (`lib/auth`): merchant cookie sessions, customer bearer tokens. No external provider. |
| Listing model | `bedrock` (Converse) and `fake` (rule-based stand-in, local dev and e2e only). Production defaults to `bedrock`. |
| Photos | `s3` and `local` drivers. Production defaults to `s3`. |
| Billing | None, by rule. `plan_status` is a plain field, `GET /api/billing/links` is a stub, `recordPickupUsage()` is a no-op hook. |
| Geocoding | Not built: `POST /merchants` keeps `lat`/`lng` null unless the portal sends them. |
| Remote push | Not built: the Expo push token is stored, nothing is sent. Notifications are polled. |
| Scheduler | None, by rule. Time-based state is derived on read (see [Time-derived state](#time-derived-state)). |

## Request flow

```
Expo app (bearer token) ─┐
Portal (session cookie) ─┼─> middleware.ts (CORS for consumer endpoints only)
                         └─> app/api/**/route.ts   thin: parse, guard, call a service
                                │  lib/http handle(): ApiError / ZodError -> contract error envelope
                                │  lib/services/session.ts: requireCustomer / requireMerchant / requireOwnMerchant (lib/auth)
                                ▼
                             lib/services/**  domain rules, read-time derivation, notifications, suggestions
                                │  lib/listing (drafts) -> lib/extract (model) + lib/photos (upload)
                                ▼
                             lib/store  Store interface -> memory | dynamodb (lib/store/dynamodb)
```

- Route handlers never import a driver, the AWS SDK, or another route. Services take the store from `db()` (`lib/services/db.ts`), which is `getStore()` plus the optional in-memory seed.
- Each request reads the time once (`now()` from `lib/clock`) and uses that instant throughout, so derived statuses agree within a response.
- Errors are thrown as `ApiError(code, message)`; `handle()` turns them into `{"error": {"code", "message"}}` with the contract's status. Anything unexpected is logged as `[api] unhandled error` and becomes 500 `INTERNAL` with a generic message.
- Every `/api` response is JSON, errors included: unknown paths (`app/api/[...path]`), the bare `/api` (`app/api/route.ts`) and every method a route does not support (each route file exports `unknownRoute` from `lib/http` for them; `tests/api/methods.test.ts` checks every route file) answer 404 `NOT_FOUND` "Not found." (the contract has no 405 code). `middleware.ts` answers a path with malformed percent-encoding the same way.
- `instrumentation.ts` runs once at server start (Node runtime) and calls `checkStartupConfig()` (`lib/startup.ts`): it logs the drivers and, in production, stops the process when a required variable is missing.

## Directory map

```
app/
  api/                                  route handlers (JSON API, base /api); one folder per contract path
    health/route.ts                     GET /api/health -> {"ok": true} (no AWS calls)
    auth/customer/{signup,signin}       customer accounts -> { token, customer }
    auth/merchant/{signup,signin,signout}  merchant accounts -> { ok } + Set-Cookie
    customers/me, customers/me/push-token
    deals, deals/[id], deals/[id]/{publish,cancel,mark-donated}
    reservations, reservations/[id], reservations/[id]/{cancel,confirm-pickup}, reservations/redeem
    follows, follows/[merchant_id]
    notifications, notifications/[id]/read
    me, merchants, merchants/[id], merchants/[id]/{deals,reservations,summary,suggestions,drafts}
    suggestions/[id]/{accept,dismiss}
    billing/links                       stub (lib/services/billing.ts)
    photos/[file]                       serves PHOTOS_DRIVER=local files; 404 with the s3 driver
    e2e/no-shows                        test-only hook for scripts/e2e.ts; 404 unless E2E_HOOKS=1 outside production
    [...path]/route.ts                  any other /api path -> 404 NOT_FOUND envelope
    route.ts                            the bare /api path -> 404 NOT_FOUND envelope
  (portal)/                             merchant portal pages (client components; guard through GET /api/me)
    layout.tsx                          PortalShell
    onboarding, today, listing, listing/manual, drafts, summary, store (store details: PATCH /merchants/{id})
  signin, signup, signout               merchant auth pages (contract: owned by the backend)
  page.tsx                              root redirect (/signin, /onboarding or /today)
  layout.tsx, globals.css               font (next/font Schibsted Grotesk), design tokens from docs/design.md
components/                             portal UI: PortalShell, AuthForm, SignOut, RootRedirect, States, PlanLink,
                                        ConfirmButton, AllergenField, DealFields, StoreForm (onboarding + store page)
lib/
  contract.ts                           types for every contract object, enum, error code, endpoint
  config.ts                             driver selection and the startup config check (all env defaults in one place)
  startup.ts                            checkStartupConfig(), called by instrumentation.ts
  env.ts                                awsRegion(), isProduction()
  http/index.ts                         route helpers: handle(), json(), ApiError, body/query parsing
  clock/index.ts                        injectable now(), America/New_York dates, ISO output with offset
  ids.ts                                newId(prefix), newSecret()
  store/                                data access (adapter)
    types.ts                            Store interface and record types
    derive.ts                           read-time status derivation
    memory.ts                           in-memory driver
    dynamodb/{index,schema}.ts          DynamoDB driver and its single-table layout
    index.ts                            getStore(), driver selection
  auth/{index,password}.ts              sign-in (adapter)
  extract/                              listing model call (adapter): index, types, config, run, schema, prompt, bedrock, fake
  photos/                               photo upload (adapter): index, types, decode, local, s3
  listing/                              listing agent code side: build (rules), drafts (service), serialize, spec-cases
  services/                             domain logic used by the routes (see "Other modules")
  client/                               portal-only browser helpers (typed API client, formatting, forms, photo resize)
middleware.ts                           CORS for consumer endpoints; 404 envelope for malformed /api paths (edge-safe, self-contained)
instrumentation.ts                      startup config check
infra/template.yaml                     CloudFormation: table, photos bucket, IAM policy, Amplify compute role
amplify.yml                             Amplify build spec (Node 22, runtime vars -> .env.production, config check)
Dockerfile, .dockerignore               container fallback (Next standalone, port 8080)
.env.example                            every environment variable (local file; .env* is gitignored)
scripts/
  seed.ts                               npm run seed: demo data into the store STORE_DRIVER selects
  curl-flows.sh                         49-request end-to-end check with curl against a running server
  e2e.ts                                npm run e2e: the full flow through the public API, every response checked against the contract shapes
  agent-cases.ts                        spec text cases 1-9 against the real model (or --fake)
tests/                                  vitest: store conformance (memory + dynamodb on dynalite), API routes, services,
                                        listing, photos, clock, http
docs/                                   contract, agent spec, design, build notes (frozen); AWS.md, DEPLOY.md, this file
```

Commands: `npm run dev`, `npm run build`, `npm start`, `npm run typecheck` (tsc --noEmit), `npm test` (vitest run), `npm run seed` (tsx scripts/seed.ts), `npm run e2e` (tsx scripts/e2e.ts), `npm run lint`.

## Data model

Records (`lib/store/types.ts`) are what is stored; API objects (`lib/contract.ts`) are built from them in `lib/services/views.ts`. Timestamps are ISO 8601 with the New York offset; money is integer cents; ids are `<prefix>_<random>` (`lib/ids.ts`). DynamoDB keys below are the driver's (`lib/store/dynamodb/schema.ts`; full layout and index list in `docs/AWS.md` section 4). Nothing is deleted except sessions, tokens and follows.

| Entity | Fields | Unique | DynamoDB item (PK / SK) | Read by |
|---|---|---|---|---|
| `MerchantAccountRecord` | `id` (`ma_`), `email` (trimmed, lowercase), `password_hash` (`scrypt$N$r$p$salt$hash`), `created_at` | `email` | `ACCOUNT#<id>` / `ACCOUNT`, marker `EMAIL#<email>` | `getMerchantAccount`, `getMerchantAccountByEmail` |
| `MerchantSessionRecord` | `id` (SHA-256 of the cookie value), `account_id`, `created_at`, `expires_at` (30 days) | `id` | `MSESSION#<id>` / `MSESSION` | `getMerchantSession` |
| `CustomerRecord` | `id` (`c_`), `name`, `phone` (E.164), `password_hash`, `expo_push_token`, `created_at` | `phone` | `CUSTOMER#<id>` / `CUSTOMER`, marker `PHONE#<phone>` | `getCustomer`, `getCustomerByPhone`, `getCustomersByIds` |
| `CustomerTokenRecord` | `id` (SHA-256 of the bearer token), `customer_id`, `created_at` (no expiry) | `id` | `CTOKEN#<id>` / `CTOKEN` | `getCustomerToken` |
| `MerchantRecord` | `id` (`m_`), `owner_account_id`, `name`, `category`, `address`, `lat`, `lng`, `phone`, `closes_at` ("HH:MM"), `default_discount_pct`, `menu` [{name, price_cents}], `plan_status` (`none`/`active`), `created_at` | `owner_account_id` (one merchant per account) | `MERCHANT#<id>` / `MERCHANT`, marker `OWNER#<account>` | `getMerchant`, `getMerchantByOwner`, `getMerchantsByIds` |
| `DealRecord` | `id` (`d_`), `merchant_id`, `title`, `items`, `original_price_cents`, `deal_price_cents`, `kind`, `quantity_total`, `quantity_left`, `max_per_customer`, `unsold_action`, `pickup_start`, `pickup_end`, `allergens`, `note`, `photo_url`, `status` (stored: `draft`/`live`/`cancelled`), `created_at`, `published_at`, `cancelled_at`, `local_date` (New York date of `created_at`, fixed), `price_lowered_by_suggestion`, `version` (optimistic concurrency) | | `DEAL#<id>` / `DEAL`; GSI1 by merchant, GSI2 by merchant + date, GSI3 `OPEN_DEALS` (sparse: stored `live` with a `pickup_end`) | `getDeal`, `getDealsByIds`, `listDealsByMerchant`, `listDealsByMerchantDate`, `listOpenDeals` |
| `ReservationRecord` | `id` (`r_`), `deal_id`, `merchant_id`, `local_date` (both copied from the deal), `customer_id`, `customer_name`, `customer_phone` (snapshots), `quantity`, `unit_price_cents` (deal price at reserve time), `total_cents`, `payment_method` (`in_store`), `pickup_code` (4 digits), `status` (stored: `reserved`/`picked_up`/`cancelled`), `created_at`, `picked_up_at`, `cancelled_at` | `pickup_code` among the merchant's `reserved` reservations | `RES#<id>` / `RES`; GSI1 by customer, GSI2 by deal, GSI3 by merchant + date, GSI4 by merchant + code; lock item `CODE#<merchant>#<code>` while reserved | `getReservation`, `listReservationsByCustomer`, `listReservationsByDeal`, `listReservationsByMerchantDate`, `findReservationsByPickupCode` |
| Follow (no record type) | `customer_id`, `merchant_id`, `created_at` | the pair | `FOLLOW#<customer>` / `M#<merchant>`; GSI1 by merchant | `listFollowedMerchantIds`, `listFollowerIds` |
| `NotificationRecord` | `id` (`n_`), `customer_id`, `type`, `title`, `body`, `deal_id`, `reservation_id`, `read`, `created_at`, `dedupe_key` | `customer_id` + `dedupe_key` | `NOTIF#<id>` / `NOTIF`; GSI1 by customer; marker `NDEDUPE#<customer>#<key>` | `getNotification`, `listNotificationsByCustomer` |
| `SuggestionStateRecord` | `id` (the API suggestion id), `merchant_id`, `type`, `deal_id`, `local_date`, `state` (`dismissed`/`accepted`), `updated_at` | `merchant_id` + `id` | `SUGG#<merchant>` / `S#<id>` | `getSuggestionState`, `listSuggestionStates` |

Derived on read, never stored: `Deal.status` `sold_out`/`expired`, `Reservation.status` `no_show`, `Customer.no_show_count`/`blocked`, `Deal.merchant`, `Deal.distance_m`, `Reservation.deal`. Suggestions are computed on request; only dismissals and acceptances are stored. Notification dedupe keys: `new_deal:<deal>`, `deal_cancelled:<deal>`, `pickup_reminder:<reservation>` per customer.

Other types in `lib/store/types.ts`: `StoreResult<T, R>` (`{ ok: true, value } | { ok: false, reason }`), `StoredDealStatus`, `StoredReservationStatus`, `NewDealRecord` (a deal without `version`), `DealPatch` (fields `updateDeal` may change), `ReserveInput`, `ReserveFailure`, `UpdateDealOptions`.

## Adapter interfaces

The four modules CLAUDE.md keeps swappable. Service-specific code (AWS SDK calls) lives only inside them.

### lib/store (data)

Entry point `lib/store/index.ts`:

- `getStore(): Store`: the process-wide store for `storeDriver()` (`memory` or `dynamodb`), memoized on `globalThis`. The `dynamodb` driver needs `DYNAMODB_TABLE`; region from `awsRegion()`; optional `DYNAMODB_ENDPOINT`.
- `storeDriver()`, `STORE_DRIVERS`, `StoreDriver`: re-exported from `lib/config.ts`.
- `setStore(store)`, `resetStore()`: tests only. `createMemoryStore()`: a fresh empty store.
- Re-exports the record types (`export type *` from `./types`) and the derive helpers.

Drivers: `lib/store/memory.ts` (`createMemoryStore`, `getMemoryStore` (the shared instance), `resetMemoryStore`; every method is synchronous inside, so each call is atomic; data is per process) and `lib/store/dynamodb/index.ts` (`createDynamoStore(options: DynamoStoreOptions)` with `{ tableName, region?, endpoint? }`, and `createDynamoStoreWithClient({ client, tableName })` for tests). `lib/store/dynamodb/schema.ts` exports the layout: `PK`, `SK`, `GSI`, `GsiName`, `KEY_ATTRIBUTES`, `INTERNAL_PREFIX`, `TYPE_ATTR`, `PICKUP_END_KEY_ATTR`, `CUSTOMER_QTY_PREFIX`, `OPEN_RES_PREFIX`, `isInternalAttribute`, `enc` (key escaping), `AFTER`, `timeSortKey`, `keys`, `indexKeys`, `tableDefinition(tableName)` (equal to the table in `infra/template.yaml`; a test checks it), `MAX_TRANSACT_ITEMS`, `MAX_BATCH_GET`.

The `Store` interface (every method is async; expected failures come back as `{ ok: false, reason }`, drivers throw only on infrastructure or programmer errors):

| Method | Guarantee |
|---|---|
| `createMerchantAccount(record)` -> `StoreResult<record, "EMAIL_TAKEN">` | email unique, also under concurrent creates |
| `getMerchantAccount(id)`, `getMerchantAccountByEmail(email)` | exact match; caller normalizes |
| `createMerchantSession(record)`, `getMerchantSession(id)`, `deleteMerchantSession(id)` | delete is idempotent |
| `createCustomer(record)` -> `StoreResult<record, "PHONE_TAKEN">` | phone unique |
| `getCustomer(id)`, `getCustomerByPhone(phone)`, `getCustomersByIds(ids)` | unknown ids skipped |
| `updateCustomer(id, { name?, expo_push_token? })` -> record or null | |
| `createCustomerToken(record)`, `getCustomerToken(id)`, `deleteCustomerToken(id)` | delete is idempotent |
| `createMerchant(record)` -> `StoreResult<record, "OWNER_HAS_MERCHANT">` | one merchant per account |
| `getMerchant(id)`, `getMerchantByOwner(accountId)`, `getMerchantsByIds(ids)`, `updateMerchant(id, patch)` | `id`, `owner_account_id`, `created_at` fixed |
| `createDeal(record: NewDealRecord)` -> `DealRecord` | version starts at 1 |
| `getDeal(id)`, `getDealsByIds(ids)` | |
| `listDealsByMerchant(merchantId, { limit? })` | all statuses, newest first |
| `listDealsByMerchantDate(merchantId, localDate)` | by `local_date`, all statuses |
| `listOpenDeals({ pickupEndAfter })` | stored `live` with `pickup_end` strictly after; soonest `pickup_end` first; never drafts or cancelled |
| `updateDeal(id, patch, { ifVersion? })` -> `StoreResult<DealRecord, "NOT_FOUND" \| "VERSION_CONFLICT">` | every write bumps `version`; with `ifVersion` the write happens only if the stored version still equals it |
| `cancelDeal(id, { at })` -> `{ deal, cancelled_reservations }` or `NOT_FOUND` / `NOT_CANCELLABLE` | atomic: the deal and every `reserved` reservation on it become `cancelled`, codes freed. Allowed for `draft`, or `live` before `pickup_end` |
| `reserve(input: ReserveInput)` -> `{ reservation, deal }` or a `ReserveFailure` | **atomic**, see below |
| `getReservation(id)`, `listReservationsByCustomer(c)`, `listReservationsByDeal(d)`, `listReservationsByMerchantDate(m, date)` | newest first, all statuses |
| `findReservationsByPickupCode(merchantId, code)` | all statuses; at most one `reserved` |
| `cancelReservation(id, { at })` -> `{ reservation, deal }` or `NOT_FOUND` / `NOT_OPEN` | atomic: `reserved` -> `cancelled`, units back to `quantity_left`, code freed. Time rules are the caller's |
| `markReservationPickedUp(id, { at })` -> record or `NOT_FOUND` / `NOT_OPEN` | atomic: `reserved` -> `picked_up`, code freed, units stay taken. Of two concurrent calls exactly one wins |
| `addFollow(c, m, at)`, `removeFollow(c, m)`, `listFollowedMerchantIds(c)`, `listFollowerIds(m)` | idempotent |
| `createNotification(record)` -> `{ notification, created }` | with a `dedupe_key`, a second create returns the first record with `created: false`, also concurrently |
| `getNotification(id)`, `listNotificationsByCustomer(c, { since? })`, `markNotificationRead(id)` | `since` = created at or after (`created_at` has seconds precision, so a poll with the newest `created_at` seen must still get one created later in that second; clients drop repeats by id) |
| `putSuggestionState(record)`, `getSuggestionState(m, id)`, `listSuggestionStates(m)` | upsert by merchant + id |

General guarantees (checked for both drivers by `tests/store/conformance.ts`): reads return copies; uniqueness holds under concurrent writes; no request path scans a table; instants are compared as times, never as strings; lists are newest first unless stated.

**The atomic reservation decrement.** `reserve(input)` checks, in this order, `DEAL_NOT_FOUND`; `DEAL_NOT_LIVE` (stored status not `live`, or `at` >= `pickup_end`); `SOLD_OUT` (`quantity_left` < quantity); `MAX_PER_CUSTOMER` (this customer's reserved + picked-up quantity on the deal + quantity > `max_per_customer`); `PICKUP_CODE_TAKEN`. Then, in one step, it decrements `quantity_left`, bumps the deal's version, takes the pickup code and creates the reservation with `unit_price_cents` = the deal's price at that moment. Of concurrent reserves for the last units, only as many succeed as there are units.

- Memory: all checks and writes run synchronously in one call, so no other call can interleave.
- DynamoDB: one `TransactWriteItems` with (1) a conditional update of the deal (`status = live AND _pek > utcKey(at) AND quantity_left >= q AND deal_price_cents = <read price> AND max_per_customer = <read max> AND` the customer's `_q#<customer>` counter `<= max - q`), which decrements `quantity_left` and adds to the counter, (2) the reservation put, (3) the pickup-code lock put with `attribute_not_exists`. A failed deal condition is re-read and reported as the right reason (or retried if only the price moved); a taken code lock is `PICKUP_CODE_TAKEN`, and `lib/services/reservations.ts` retries with a new random code.

Services use `updateDealWithRetry` (`lib/services/deals.ts`) for every other read-check-write on a deal: read, check, `updateDeal(..., { ifVersion })`, re-read and retry on `VERSION_CONFLICT`. A live deal's reserved units are `quantity_total - quantity_left`, never a count from a list method (lists on DynamoDB are eventually consistent).

### lib/auth (sign-in)

Route handlers and pages use only these (`lib/auth/index.ts`); an external provider can replace the module behind the same functions. `RequestLike` is anything with `headers.get()`: a `Request`, or `{ headers: await headers() }` in a server component.

| Export | Behaviour |
|---|---|
| `getCurrentMerchant(req)` -> `SignedInMerchant \| null` | `{ account: MerchantAccount, merchant: MerchantRecord \| null }` from the `merchant_session` cookie; null without a valid, unexpired session. `merchant: null` = not onboarded. `MerchantAccount` is the account without `password_hash`. |
| `getCurrentCustomer(req)` -> `CustomerRecord \| null` | from `Authorization: Bearer <token>`; tokens do not expire |
| `createMerchantSession(accountId)` -> `{ setCookie }` | new session (30 days, `MERCHANT_SESSION_DAYS`); cookie `MERCHANT_SESSION_COOKIE` = `merchant_session`, `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`, plus `Secure` in production |
| `destroyMerchantSession(req)` -> `{ setCookie }` | deletes the session (if any) and clears the cookie |
| `createCustomerToken(customerId)` -> raw token | returned once to the client; only its SHA-256 is stored |
| `revokeCustomerToken(req)` | exists, unused (the contract has no customer sign-out) |
| `hashPassword(pw)`, `verifyPassword(pw, hash)` | scrypt (N=16384, r=8, p=1, 16-byte salt per user), `timingSafeEqual`; hash format `scrypt$N$r$p$salt$hash` |
| `normalizeEmail(email)` | trimmed, lowercase |

`lib/auth/password.ts` holds the implementation: `hashPassword`, `verifyPassword`, `dummyPasswordHash()` (sign-in for an unknown email or phone verifies against it, so a miss takes as long as a wrong password) and `secretLookupKey(secret)` (SHA-256, base64url: the stored id of sessions and tokens). Session ids and tokens come from `newSecret()` (256 random bits). The account flows themselves (signup/signin, 409 `ACCOUNT_EXISTS`, 401 `BAD_CREDENTIALS`) are in `lib/services/accounts.ts`; the 401/404 guards are in `lib/services/session.ts`.

### lib/extract (listing model)

`extract(input: ExtractInput): Promise<ExtractResult>` runs the agent spec's extract step and never throws: model, configuration, timeout and schema failures come back as `{ ok: false, reason: "invalid_output" | "model_error" | "timeout", log }`.

- `ExtractInput`: `{ now_local, closes_at, category, text, photo: ExtractPhoto | null, menu_item_names }` (no prices are sent). `ExtractOutput`: `{ products: ExtractedProduct[], pickup_start, pickup_end }`. `ExtractResult`: `{ ok: true, output, log } | { ok: false, reason: ExtractFailureReason, log }`. `ExtractLog` holds what the spec says to log (input text, `photo_sent`, raw output, validation result, latency, provider, model id, outcome, error, per-attempt `ExtractAttemptLog`s), never the photo. `EXTRACT_LIMITS`: 20 products, 15 s for the whole step (retry included), 2 attempts, 4096 output tokens.
- `modelFromEnv()` picks the provider (`listingProvider()` from `lib/config.ts`): `createBedrockModel(listingModelConfig())` or `createFakeModel()`. A provider implements `ExtractModel` (`provider`, `modelId`, `call(input, previous: FailedAttempt[], signal) -> ModelReply`).
- `runExtract(input, model, options?: RunExtractOptions)`: the shared control flow: validate with `validateExtractOutput` (zod; `ValidationResult`), retry once replaying the bad answer with the validation error, abort at the time budget, log one JSON line per call with `defaultExtractLogger` (`[listing.extract] {...}`). `configFailure()` builds the failed result for a configuration error.
- `listingModelConfig(env?)` -> `ListingModelConfig` `{ provider, modelId, temperature, toolChoice, extraFields, promptVariant }` from `LISTING_MODEL_ID`, `LISTING_MODEL_TEMPERATURE`, `LISTING_TOOL_CHOICE` (`TOOL_CHOICES`: `auto` | `tool`; `ToolChoiceMode`), `LISTING_MODEL_EXTRA_FIELDS` and `LISTING_PROMPT_VARIANT` (`PROMPT_VARIANTS`: `spec` | `v2`; `PromptVariant`); throws `ListingConfigError`. `LISTING_PROVIDERS` / `ListingProvider` are re-exported from `lib/config.ts`.
- Bedrock (`bedrock.ts`): one Converse call per attempt with one tool, `TOOL_NAME` = `record_listing`, whose input schema is `OUTPUT_JSON_SCHEMA` (`TOOL_DESCRIPTION`). `buildConverseInput()` (temperature only when set; `toolChoice` auto unless `tool`; extra fields as `additionalModelRequestFields`; image block first), `readConverseReply()`, `getBedrockClient(region?)` (one client per region, `maxAttempts` 2), `imageFormatOf(contentType)`, `ConverseSender` (lets tests replace the network).
- Prompt (`prompt.ts`): `SPEC_INSTRUCTION` (the spec's instruction verbatim), `TOOL_INSTRUCTION`, `SYSTEM_PROMPT`, `V2_CLARIFICATIONS`, `systemPromptFor(variant)` (`spec` -> `SYSTEM_PROMPT`; `v2` -> instruction + clarifications + tool instruction), `buildUserText(input)` (context plus the merchant text JSON-quoted inside `<merchant_message>` with `quoteMerchantText()`), `retryText(error)`.
- Fake (`fake.ts`): `fakeExtract(input)`, `createFakeModel()`, helpers `singularize`, `resolveClock`. Deterministic English rules; local dev and e2e only.

### lib/photos (photo upload)

`putPhoto(bytes, contentType): Promise<string>` stores the image and returns a public URL for `Deal.photo_url`. `getPhotoStore()` returns a `PhotoStore` (`{ driver: "local" | "s3", put(bytes, contentType) }`) for `photosDriver()` (`PHOTOS_DRIVERS`, `PhotosDriver`, re-exported from `lib/config.ts`).

- Decoding (`decode.ts`): `decodePhotoBase64(value)` -> `DecodedPhoto` `{ bytes, contentType }` or null for an empty string; accepts plain base64, base64url or a `data:` URL; checks magic bytes (`detectPhotoType`, `isPhotoContentType`, `PHOTO_TYPES`: JPEG, PNG, WebP, GIF; `PhotoContentType`) and the 2 MB decoded limit (`PHOTO_LIMITS`); otherwise 422 `VALIDATION`.
- S3 (`s3.ts`): `createS3PhotoStore(options: S3PhotoStoreOptions)` puts `photos/<random>.<ext>` (`S3_PHOTO_PREFIX`) with no ACL and an immutable cache header; the URL is `PHOTOS_PUBLIC_BASE_URL/photos/<file>` or `s3PublicUrl()` = `https://<bucket>.s3.<region>.amazonaws.com/photos/<file>`. `getS3Client(region?)`, `PutObjectSender` (test seam). Public read comes from the bucket policy (`infra/template.yaml`).
- Local (`local.ts`): `createLocalPhotoStore({ dir?, urlPrefix? })` writes `<PHOTOS_LOCAL_DIR or .data/photos>/<random>.<ext>` (`localPhotoDir()`, `photoFileName()`) and returns `/api/photos/<file>` (`LOCAL_PHOTO_URL_PREFIX`), served by `app/api/photos/[file]` through `localPhotoResponse()` / `readLocalPhoto()` (file names are checked, no path traversal). Not for production: the disk is neither shared nor kept.
- An upload failure does not fail the drafts request: drafts are returned with `photo_url: null` and `[listing.drafts] photo upload failed` is logged.

### lib/config and the startup check

`lib/config.ts` is the one place that reads the driver variables. Each choice defaults to the local driver in dev and tests and to the AWS driver when `NODE_ENV=production`:

| Function | Variable | Dev / test default | Production default | Needs |
|---|---|---|---|---|
| `storeDriver(env?)` | `STORE_DRIVER` | `memory` | `dynamodb` | `DYNAMODB_TABLE` |
| `photosDriver(env?)` | `PHOTOS_DRIVER` | `local` | `s3` | `PHOTOS_BUCKET` |
| `listingProvider(env?)` | `LISTING_MODEL_PROVIDER` | `fake` | `bedrock` | `LISTING_MODEL_ID` |

Other exports: `STORE_DRIVERS`, `PHOTOS_DRIVERS`, `LISTING_PROVIDERS` and their types (`StoreDriver`, `PhotosDriver`, `ListingProvider`), `Env`, `ConfigError` (unknown value; the message names the variable), `isProductionEnv(env?)`, `listingProviderIsDefault(env?)`, `e2eHooksEnabled(env?)` (`E2E_HOOKS=1` and not production), `checkConfig(env?)` -> `ConfigReport` `{ production, drivers: DriverSelection | null, errors, warnings }` (never throws), `assertStartupConfig(env?, log?)` (logs `[config] drivers: ...` and warnings; in production throws `ConfigError` listing every error). `lib/startup.ts` `checkStartupConfig()` calls it and exits the process with `[config] Stopping: ...` on an error; `instrumentation.ts` runs it once per server start. `amplify.yml` applies the same rules at build time so a broken configuration fails the build first.

## Other modules

### lib/contract.ts

Types for everything in contract v0.6, field names exactly as in the contract; nullable fields are `T | null`, never optional.

- Enums (`const` arrays and union types): `MERCHANT_CATEGORIES`/`MerchantCategory`, `PLAN_STATUSES`/`PlanStatus`, `DEAL_KINDS`/`DealKind`, `DEAL_STATUSES`/`DealStatus`, `UNSOLD_ACTIONS`/`UnsoldAction`, `RESERVATION_STATUSES`/`ReservationStatus`, `PAYMENT_METHODS`/`PaymentMethod`, `NOTIFICATION_TYPES`/`NotificationType`, `SUGGESTION_TYPES`/`SuggestionType`, `PRICE_SOURCES`/`PriceSource`, `MISSING_FIELDS`/`MissingField`, `DEAL_SORTS`/`DealSort`.
- Errors: `ERROR_STATUS` (code -> HTTP status), `ErrorCode`, `ERROR_CODES`, `INTERNAL_ERROR_CODE` / `INTERNAL_ERROR_STATUS` (500, not a contract code; keeps the envelope for unexpected failures), `ApiErrorCode`, `ApiErrorBody`.
- `RULES`: password length 8, discount 10-90, 4-digit codes, no-show after 15 min, blocked at 2 no-shows, reminder 30 min before `pickup_end`, `list_now` window 120 min, `lower_price` x0.8 in 25-cent steps with a 25-cent minimum, `max_per_customer` default 2, assumed sell-through 0.6.
- Objects: `Customer`, `MenuItem`, `Merchant`, `DealMerchant`, `DealItem`, `Deal`, `Estimate`, `Draft`, `Reservation`, `Notification`, `LowerPriceBasis`, `LowerPriceSuggestion`, `ListNowSuggestion`, `Suggestion`, `Summary`, `BillingLinks`.
- Requests and responses: `OkResponse`, `HealthResponse`, `CustomerSignupRequest`, `CustomerSigninRequest`, `CustomerAuthResponse`, `MerchantSignupRequest`, `MerchantSigninRequest`, `DealsQuery`, `DealsResponse`, `CreateReservationRequest`, `ReservationsResponse`, `FollowsResponse`, `FollowRequest`, `NotificationsQuery`, `NotificationsResponse`, `PushTokenRequest`, `MeResponse`, `CreateMerchantRequest`, `UpdateMerchantRequest`, `CreateDraftsRequest`, `DraftsResponse`, `DraftEditableFields`, `LiveEditableField`, `CreateDealRequest`, `UpdateDraftDealRequest`, `UpdateLiveDealRequest`, `UpdateDealRequest`, `DateQuery`, `RedeemRequest`, `SuggestionsResponse`, `AcceptSuggestionResponse`.
- `ApiEndpoints` (map keyed by `"METHOD /path"`, relative to `/api`) and `ApiEndpointKey`, used by the typed portal client.

### lib/http

`handle(fn)` (thrown `ApiError` / `ZodError` -> envelope; anything else logged and 500 via `toErrorResponse()`), `ApiError`, `isApiError`, `json(data, statusOrInit?)` (adds `cache-control: no-store`), `ok()`, `errorResponse(code, message)`, `readJson(request)` (empty or malformed -> 422), `readJsonStrict(request)` (also 422 unless `Content-Type: application/json`; merchant sign-in and sign-up use it, so a cross-site form cannot sign a browser into another account), `hasJsonContentType(request)`, `parseJsonBody(request, schema)`, `parseWith(schema, value)`, `queryObject(request)`, `validationError(zodError)` (`"<field>: <message>"`), `unknownRoute` (404 `NOT_FOUND` handler for unknown paths and unsupported methods), `INTERNAL_ERROR_MESSAGE`.

### lib/clock, lib/ids, lib/env

- `lib/clock`: `now()` is the only way server code reads the time; tests use `setNow`, `advanceNow`, `resetNow`. Business dates are `BUSINESS_TIME_ZONE` = America/New_York: `today()`, `localDateOf`, `localTimeOf`, `startOfLocalDate`, `endOfLocalDate`, `zonedDateTime(date, "HH:MM")`, `addDays`, `nyOffsetMinutes`. Output `toIso` / `nowIso` (ISO with the New York offset). Parsing `parseInstant`, `isIsoInstant`, `isLocalDate`, `isLocalTime`, `toDate`, `toMs`. `INSTANT_RANGE` / `isInstantInRange` (2000-01-01 to 2100-01-01 UTC: the instants the API accepts from clients, so `toIso` always writes a string `parseInstant` reads back). Arithmetic `addMinutes`, `minutesBetween`, `roundUpToMinutes`, `compareInstants`. `utcKey` (sortable UTC key for DynamoDB). `formatTime12` ("6:00 PM"). Type `Instant`.
- `lib/ids.ts`: `newId(prefix)` with `ID_PREFIX` / `IdPrefix` (c, m, ma, d, r, n, s; 72 random bits), `newSecret()` (256 bits).
- `lib/env.ts`: `awsRegion()` (`APP_AWS_REGION`, then `AWS_REGION`, else undefined so the SDK chain decides), `isProduction()`.

### lib/listing (agent code side)

- `build.ts`, pure functions for the spec's build step: `buildDrafts(output, ctx: BuildContext)` -> `DraftPlan[]` (`buildDraft` per product; `DraftDealFields`), `resolvePrices` (`PriceResolution`, `DealPriceRule`), `computeDealPrice` (integer math, 25-cent steps, never 0), `findHistoryDeal`, `normalizeProductName`, `titleCase`, `buildTitle`, `closingInstant`, `resolvePickupStart`, `resolvePickupEnd`, `resolveKind`, `resolveAllergens`, `missingFieldsOf`, `buildAgentNotes` (`NOTE_TEMPLATES`), `buildEstimate`, constants `BUILD_RULES`.
- `drafts.ts`: `createDrafts(merchant, body: DraftsRequestBody, deps?: DraftsDeps)` (validate, then history + extract + photo upload in parallel, build, save each draft with `store.createDeal`, return `{ drafts }`), `parseDraftsRequest`, `normalizeDraftText`, `draftRecordOf`, `DRAFT_LIMITS` (2000 characters, 100 deals of history).
- `serialize.ts`: `dealFromRecord`, `dealMerchantOf` (delegate to `lib/services/views.ts`).
- `spec-cases.ts`: `SPEC_CONTEXT`, `SPEC_CASES` (`SpecCase`, `CheckedDraft`), `specNow`, `specBuildContext`, used by `tests/listing/cases.test.ts` and `scripts/agent-cases.ts`.

### lib/services (domain logic)

| File | Exports |
|---|---|
| `db.ts` | `db()` (the store; seeds the memory store once when `SEED_ON_START=1`), `resetSeedOnStart()` |
| `session.ts` | `requireMerchantSession`, `requireMerchant` (404 "Set up your store first." before onboarding), `requireOwnMerchant(req, id)` (404 for another merchant's id), `requireCustomer`, `MESSAGES` |
| `accounts.ts` | `signupCustomer`, `signinCustomer`, `signupMerchant`, `signinMerchant`, schemas `customerSignupSchema`, `customerSigninSchema`, `merchantSignupSchema`, `merchantSigninSchema` |
| `merchants.ts` | `createMerchant(accountId, body)`, `updateMerchant(merchant, body)`, `createMerchantSchema`, `updateMerchantSchema` |
| `customers.ts` | `getMe`, `savePushToken`, `pushTokenSchema`, `listFollows`, `follow`, `unfollow`, `followSchema` |
| `deals.ts` | `createDeal`, `updateDeal` (draft and live rules; price lower only), `publishDeal` (field checks, plan gate, `new_deal` notifications), `cancelDeal`, `markDealDonated`, `listMerchantDeals`, `listPublicDeals` / `parsePublicDealsQuery` / `PublicDealsQuery` (GET /deals with sort and distance; `sort=discount`, biggest discount first, is an additive extension of contract v0.6), `getPublicDeal` (a deal never published, a draft or a discarded draft, is 404 for everyone but its merchant), `loadOwnDeal`, `updateDealWithRetry`, `createDealSchema`, `patchDealSchema` |
| `reservations.ts` | `reserve` (blocked check, atomic store reserve, code retry), `listCustomerReservations`, `getCustomerReservation`, `cancelReservation`, `confirmPickup`, `redeem`, `listMerchantReservations`, `randomPickupCode`, `createReservationSchema`, `redeemSchema` |
| `notifications.ts` | `notifyNewDeal`, `notifyDealCancelled`, `createDuePickupReminders`, `listNotifications`, `markNotificationRead`, bodies `newDealBody`, `dealCancelledBody`, `pickupReminderBody` |
| `suggestions.ts` | `listSuggestions`, `acceptSuggestion`, `dismissSuggestion`, `lowerPriceFor`, `proposedLowerPrice`, ids `lowerPriceSuggestionId` (`s_lp_<deal>`), `listNowSuggestionId` (`s_ln_<date>_<merchant>`) |
| `summary.ts` | `getSummary(merchant, date, at)`, `PLATFORM_FEE_CENTS_PER_PICKUP` (99) |
| `billing.ts` | `recordPickupUsage(reservation)` (no-op hook), `planGateEnabled()`, `billingLinks()` (stub: empty URLs = no page yet; the portal hides "Choose a plan" for an empty `pricing_url`) |
| `views.ts` | records -> contract objects with derived fields: `merchantView`, `dealMerchantView`, `dealView`, `reservationView`, `notificationView`, `loadDealView`, `loadDealViews`, `loadReservationView`, `loadReservationViews`, `loadCustomerView`, `customerNoShowCount` |
| `validation.ts` | zod building blocks with user-safe messages: `E164`, `text`, `cents`, `positiveInt`, `phone`, `email`, `newPassword`, `anyPassword`, `localTime`, `instant` (ISO with offset, inside `INSTANT_RANGE`), `latitude`, `longitude`, `parseDateQuery`, `parseQueryNumber` |
| `format.ts`, `geo.ts` | `formatCents`, `plural`; `haversineMeters` |
| `seed.ts` | `seedStore(store, at?)` -> `SeedResult` (idempotent), `SEED_MERCHANT`, `SEED_CUSTOMER` |
| `e2e-hooks.ts` | `requireE2eHooks()`, `createNoShows(body)` -> `NoShowsResult` (test-only; behind `E2E_HOOKS`) |

### lib/client (portal, browser only)

- `api.ts`: one typed wrapper per merchant endpoint (`merchantSignup`, `merchantSignin`, `merchantSignout`, `getMe`, `createMerchant`, `updateMerchant`, `getMerchant`, `createDrafts`, `createDeal`, `updateDeal`, `publishDeal`, `cancelDeal`, `markDealDonated`, `listMerchantDeals`, `listMerchantReservations`, `redeemPickupCode`, `getSummary`, `listSuggestions`, `acceptSuggestion`, `dismissSuggestion`, `getBillingLinks`), `API_BASE` (`/api`, same origin), `ApiClientError` / `ClientErrorCode`, `errorMessage`, `errorCode`, `UNAUTHORIZED_EVENT` (fired on 401 so the shell redirects to /signin).
- `format.ts`: `formatCents`, `centsToInput`, `parseCents`, `parseWhole`, `untilTime`, `time12`, `localTime12`, `isoToTimeInput`, `isoToLocalDate`, `timeInputToIso`, `formatLocalDate`, `toE164`, `formatPhone`, `DEAL_STATUS_LABEL`, `RESERVATION_STATUS_LABEL`, `paymentLine`.
- `deal-form.ts`: `DealForm`, `DealFormField`, `DealFormErrors`, `DealFormValues`, `formFromDeal`, `missingInForm`, `validateDealForm` (an end time earlier than the start time is on the next day), `endsNextDay`, `kindFor` (agent rule against the nearest closing time; manual entry and draft review both send it), `estimateCents`.
- `photo.ts`: `resizePhoto(file)` -> `ResizedPhoto` (JPEG, at most `MAX_PHOTO_BYTES` = 900 KB). `drafts-cache.ts`: `saveDrafts`, `loadDrafts`, `forgetDraft` (sessionStorage).

## Time-derived state

No scheduler (CLAUDE.md). Everything time-based is computed when it is read, from the request's single `now()`:

| State | Rule | Computed in | Called from |
|---|---|---|---|
| Deal `expired` | stored `live` and now >= `pickup_end` | `deriveDealStatus` (`lib/store/derive.ts`) | `dealView` (every Deal the API returns), deal transitions in `lib/services/deals.ts`, `reserve`, suggestions |
| Deal `sold_out` | stored `live`, before `pickup_end`, `quantity_left` = 0 | `deriveDealStatus` | same |
| Reservation `no_show` | stored `reserved` and now >= `pickup_end` + 15 min (`noShowAt`) | `deriveReservationStatus` | `reservationView`, `getSummary`, `countNoShows` |
| `Customer.no_show_count`, `blocked` | count of the customer's derived no-shows; blocked at 2 | `countNoShows`, `isBlocked` via `customerNoShowCount` / `loadCustomerView` (`lib/services/views.ts`) | `GET /customers/me`, and `reserve` (403 `CUSTOMER_BLOCKED` before any deal check) |
| `pickup_reminder` notifications | reservation still `reserved`, pickup_end - 30 min <= now < pickup_end, and it existed at pickup_end - 30 min; dedupe key per reservation | `createDuePickupReminders` (`lib/services/notifications.ts`) | `GET /notifications` (created on the customer's poll, then listed) |
| `list_now` suggestion | closes_at - 120 min <= now < closes_at (closes_at on today's New York date) and no deal of any status with today's `local_date`; not dismissed today | `lib/services/suggestions.ts` | `GET /merchants/{id}/suggestions` |
| `lower_price` suggestion | derived `live`; (now - published_at) x 2 >= pickup_end - published_at; reserved x 2 < total; not lowered by a suggestion; not dismissed or accepted | `lowerPriceFor` | suggestions list and accept (rechecked on accept) |
| Business date of a deal / reservation | `local_date` = New York date of `created_at`, fixed at creation | `localDateOf` (`lib/clock`) | `?date=` lists, summary, `list_now` |
| Summary numbers | units by derived status of that day's published deals | `getSummary` (`lib/services/summary.ts`) | `GET /merchants/{id}/summary` |

Consequence: a no-show's pickup code stays locked (its stored status is still `reserved`), and a reminder is only created if the customer polls inside the 30-minute window.

## Environment variables

Every variable the code reads. `.env.example` has the same list with comments; `amplify.yml` passes the runtime ones (marked R) into the Amplify server through `.env.production`.

| Name | Purpose | Example | Required | Read by |
|---|---|---|---|---|
| `STORE_DRIVER` (R) | Data driver: `memory` or `dynamodb` | `dynamodb` | optional; default `memory` in dev/test, `dynamodb` in production | `lib/config.ts` |
| `DYNAMODB_TABLE` (R) | Table name (stack output `TableName`) | `app-main` | required when the store driver is `dynamodb` | `lib/store/index.ts`, `lib/config.ts` |
| `DYNAMODB_ENDPOINT` | Local DynamoDB emulator endpoint; loopback gets dummy credentials. Never on AWS | `http://127.0.0.1:4567` | optional | `lib/store/index.ts` |
| `APP_AWS_REGION` (R) | Region for every AWS client (Amplify reserves the `AWS` prefix) | `us-east-1` | optional; recommended on AWS | `lib/env.ts`, `lib/config.ts` |
| `AWS_REGION` | Fallback region; set by Lambda/Amplify, App Runner and ECS | `us-east-1` | optional | `lib/env.ts`, `lib/config.ts` |
| `PHOTOS_DRIVER` (R) | Photo driver: `local` or `s3` | `s3` | optional; default `local` in dev/test, `s3` in production | `lib/config.ts` |
| `PHOTOS_BUCKET` (R) | Photos bucket (stack output `PhotosBucketName`), keys under `photos/` | `app-photos-123456789012-us-east-1` | required when the photo driver is `s3` | `lib/photos/index.ts`, `lib/config.ts` |
| `PHOTOS_PUBLIC_BASE_URL` (R) | Public base URL that maps to the bucket root (e.g. CloudFront) | `https://d1234example.cloudfront.net` | optional; default the bucket's regional S3 URL | `lib/photos/index.ts` |
| `PHOTOS_LOCAL_DIR` | Directory for the local photo driver | `/tmp/photos` | optional; default `<cwd>/.data/photos` | `lib/photos/local.ts` |
| `LISTING_MODEL_PROVIDER` (R) | Listing model: `bedrock` or `fake` | `bedrock` | optional; default `fake` in dev/test, `bedrock` in production | `lib/config.ts` (also named in `lib/extract/index.ts` logs) |
| `LISTING_MODEL_ID` (R) | Bedrock model or inference profile id (image input + tool use) | `us.anthropic.<model>` | required when the provider is `bedrock` | `lib/extract/config.ts`, `lib/config.ts` |
| `LISTING_MODEL_TEMPERATURE` (R) | Sent as `inferenceConfig.temperature` only when set, 0-1 | `0` | optional; Claude Haiku 4.5, Sonnet 4.5 and Sonnet 4.6 accept `0` (listing A/B, 2026-10-11); leave unset for models that reject it | `lib/extract/config.ts` |
| `LISTING_TOOL_CHOICE` (R) | `auto` (default) or `tool` (forces the tool) | `tool` | optional | `lib/extract/config.ts` |
| `LISTING_MODEL_EXTRA_FIELDS` (R) | JSON object sent as `additionalModelRequestFields`; no `#` or `$` | `{"top_k":1}` | optional | `lib/extract/config.ts` |
| `LISTING_PROMPT_VARIANT` (R) | System prompt: `spec` (the spec's instruction verbatim) or `v2` (the same instruction plus clarifications, `V2_CLARIFICATIONS`) | `v2` | optional; default `spec` | `lib/extract/config.ts`, `lib/extract/prompt.ts` |
| `PLAN_GATE` (R) | `1` = publish returns 402 `PLAN_REQUIRED` for `plan_status: "none"` | `1` | optional; off by default | `lib/services/billing.ts` |
| `SEED_ON_START` (R) | `1` = seed the demo data into the memory store on the first request | `1` | optional; memory driver only | `lib/services/db.ts` |
| `E2E_HOOKS` | `1` = enable the test-only `/api/e2e/*` hooks; ignored in production | `1` | optional; dev and e2e only | `lib/config.ts` |
| `E2E_BASE_URL` | Base URL for `scripts/e2e.ts` when no argument is given | `http://localhost:3000` | optional; script only | `scripts/e2e.ts` |
| `NODE_ENV` | Set by Next.js. `production`: Secure cookie, AWS driver defaults, startup check exits on errors, e2e hooks off, warnings for local drivers | `production` | set by the platform | `lib/env.ts` (`isProduction()`), `lib/config.ts` |
| `NEXT_RUNTIME` | Set by Next.js; the startup check runs only in `nodejs` | `nodejs` | set by the platform | `instrumentation.ts` |
| `NEXT_DIST_DIR` | Build output dir, so several dev servers can share one checkout. Never on Amplify | `.next-core` | optional; default `.next` | `next.config.ts` |
| `NEXT_OUTPUT` | `standalone` builds the self-contained server for the Dockerfile | `standalone` | optional; the Dockerfile sets it | `next.config.ts` |
| `AWS_BEARER_TOKEN_BEDROCK` | Bedrock API key the SDK can use instead of IAM credentials; the script only checks whether it is set | (API key) | optional; scripts only | `scripts/agent-cases.ts` |
| `DYNAMODB_IT_TABLE` | Run the Store conformance suite against this real table (throwaway; test rows are never deleted) | `app-it-main` | optional; tests only | `tests/store/dynamodb.test.ts` |

Not read by the app but by the standalone server: `PORT`, `HOSTNAME` (the Dockerfile sets `8080`, `0.0.0.0`). AWS credentials are never variables you set on AWS: Amplify, App Runner and ECS give the role's temporary credentials to the SDK's default chain. Tests force `STORE_DRIVER=memory`, `PHOTOS_DRIVER=local`, `LISTING_MODEL_PROVIDER=fake` (`vitest.config.mts`). Never commit `.env*`.

## Integration points

What to change for each swap. Route handlers, services and the portal stay as they are.

| To change | Edit | Keep |
|---|---|---|
| Data store (another table design, another database) | A new driver implementing `Store` in `lib/store/<driver>/`, wired in `getStore()` (`lib/store/index.ts`) and `storeDriver()` / `checkConfig()` (`lib/config.ts`). Run `runStoreConformance(name, factory)` from `tests/store/conformance.ts` against it. For DynamoDB layout changes: `lib/store/dynamodb/schema.ts` and the table in `infra/template.yaml` together (a test compares them). | The `Store` interface and its guarantees, especially atomic `reserve`, `cancelDeal`, `markReservationPickedUp` and `updateDeal` with `ifVersion`. Any new method must go into both drivers and the conformance suite. |
| Sign-in (Cognito or another provider) | `lib/auth/index.ts` behind the same exports: `getCurrentMerchant`, `getCurrentCustomer`, `createMerchantSession`, `destroyMerchantSession`, `createCustomerToken`; and the account flows in `lib/services/accounts.ts`. The pages `app/signin`, `app/signup`, `app/signout` belong to sign-in (contract). | `SignedInMerchant` shape (`merchant: null` before onboarding), 401 `UNAUTHORIZED` from `lib/services/session.ts`, bearer tokens for customers (the Expo app sends `Authorization: Bearer`). |
| Listing model (another Bedrock model or provider) | Config only for another Bedrock model: `LISTING_MODEL_ID` (+ the stack's `BedrockModelPattern`). Another provider: a new `ExtractModel` in `lib/extract/<provider>.ts`, chosen in `modelFromEnv()` (`lib/extract/index.ts`) and `listingProvider()` (`lib/config.ts`). | `extract()` signature and never-throw behaviour, `runExtract()` (schema check, one retry, 15 s budget, log line), the build step in `lib/listing/build.ts`. |
| Photo storage (CloudFront, another bucket) | CloudFront: set `PHOTOS_PUBLIC_BASE_URL`. Another service: a `PhotoStore` in `lib/photos/<driver>.ts`, chosen in `getPhotoStore()` (`lib/photos/index.ts`) and `photosDriver()` (`lib/config.ts`). | `putPhoto(bytes, contentType) -> public URL`, the 2 MB / type checks in `decode.ts`. |
| Billing (`/monetize`) | `lib/services/billing.ts`: `recordPickupUsage()` (one usage event per picked-up reservation; already awaited once per transition), `billingLinks()` (real URLs), `planGateEnabled()`. `plan_status` is changed with `store.updateMerchant(id, { plan_status })`. New server variables go into `RUNTIME_VARS` in `amplify.yml`. Checklist: `docs/DEPLOY.md` section 13. | Contract shapes (additive only), the call site in `lib/services/reservations.ts`. |
| Hosting | `amplify.yml` (Amplify), `Dockerfile` (container). | Node 22, Next 15. |
| Geocoding (optional, not built) | `lib/services/merchants.ts` (`createMerchant` / `updateMerchant` when `lat`/`lng` are not sent). Needs an AWS service (e.g. Location) behind its own module and IAM permission. | `lat`/`lng` both null when not located. |

## Files you should not need to touch

- `docs/api-contract.md`, `docs/agent-spec.md`, `docs/design.md`, `docs/build-notes.md`: frozen (changes to the contract are additive and announced).
- `lib/contract.ts`, `lib/http/**`, `lib/clock/**`, `lib/ids.ts`: shared foundations; every route and service depends on them.
- `app/api/**`: thin handlers; behaviour lives in `lib/services/**`.
- `lib/services/**` and `lib/listing/**` when swapping an adapter: they only use the adapter interfaces.
- `middleware.ts` (CORS), `app/(portal)/**`, `components/**`, `lib/client/**` (portal; talks to the API only).
- `tests/store/conformance.ts`: extend it for new Store methods, do not weaken it.

## Running things

All with Node 22. `npm ci` once.

| What | Command | Notes |
|---|---|---|
| Dev server | `npm run dev` (or `NEXT_DIST_DIR=.next-x npx next dev -p 3101`) | Local drivers by default; `SEED_ON_START=1` gives demo data. |
| Type-check, lint | `npm run typecheck`, `npm run lint` | `next build` type-checks the whole project too (Amplify fails on any error). |
| Tests | `npm test` | vitest: store conformance on memory and on DynamoDB (dynalite in-process, `TransactWriteItems` emulated by `tests/store/dynamodb-emulator.ts`), every route handler with a pinned clock, services, listing build and spec cases, photos, CloudFormation template checks. No AWS calls. Real-table conformance: `DYNAMODB_IT_TABLE=<table> APP_AWS_REGION=<region> npx vitest run tests/store/dynamodb.test.ts`. |
| Seed | `npm run seed` | Writes the demo merchant (`demo-merchant@example.com` / `demo-merchant-pass`), its bakery, two live deals and a customer (`+18145550123` / `demo-customer-pass`) into the store `STORE_DRIVER` selects; idempotent. With the memory driver the data dies with the script: use `SEED_ON_START=1` on the dev server instead. Against AWS: `STORE_DRIVER=dynamodb DYNAMODB_TABLE=<table> APP_AWS_REGION=<region> npm run seed` with laptop credentials. |
| Curl flows | `bash scripts/curl-flows.sh [base_url]` | 49 requests through the consumer and merchant flows against a running, seeded server (default `http://localhost:3101`); exits 1 on the first unexpected status. Writes test data. |
| e2e script | `npm run e2e -- [base_url]` (default `http://localhost:3000`, or `E2E_BASE_URL`) | Plays a new merchant and three customers through the public API (signup, onboarding, drafts, publish, follow, reserve, cancel, redeem, summary, notifications, price drop, cancel deal, blocked customer, sign-out) and checks every response against the contract's shapes, written out in the script. Unique emails and phones per run. The blocked-customer step needs the server started with `E2E_HOOKS=1` outside production (`app/api/e2e/no-shows`, `lib/services/e2e-hooks.ts`); otherwise it prints SKIP. Exit 0 all passed, 1 a step failed, 2 server unreachable. Local: `E2E_HOOKS=1 npm run dev`, then `npm run e2e`. |
| Agent cases | `LISTING_MODEL_ID=<id> APP_AWS_REGION=<region> npx tsx scripts/agent-cases.ts` (or `--fake`) | Spec text cases 1-9 against the real model; exit 0 all pass, 1 some fail, 2 missing model id, region or credentials (nothing sent). |
| Listing A/B | `APP_AWS_REGION=<region> npx tsx scripts/eval/listing-ab.ts --cases <dir> --out <dir> --label <name> --models <ids> --temps 0,unset --tools tool,auto --prompts spec,v2 --imgs 1568 --repeats N` | Runs the real extract + build step in-process for every case x config; scores products/quantities and invented values; writes `<label>.json` and `<label>.md`. Case format in the script header. |
| Production build locally | `NEXT_DIST_DIR=.next-x npx next build`; container shape: `NEXT_OUTPUT=standalone npx next build`, copy `.next/static` into `.next/standalone/.next/`, `node .next/standalone/server.js` | With `NODE_ENV=production` the drivers default to AWS: pass `STORE_DRIVER=memory PHOTOS_DRIVER=local LISTING_MODEL_PROVIDER=fake` for a local run. |

Several servers in one checkout: give each its own `NEXT_DIST_DIR` and port. `next-env.d.ts` is generated and gitignored; it points at whichever dist dir built last.
