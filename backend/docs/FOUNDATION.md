# Backend foundation — API Contract v0.6

## Inspection and scope

The checkout started with README.md only: no Next.js/Expo app, dependency manifest, or teammate-owned implementation. Changes are isolated under backend/ on dev-david, plus the root .gitignore. The original README is untouched. No Prisma or SQL.

The supplied contract is preserved in API-CONTRACT-v0.6.md. It supersedes older screenshot behavior: customer accounts replace devices; live prices may decrease; follows, notifications and distance browsing are added. Exact DTO field names live in lib/db/models.ts. Nullable public fields remain present. Do not expose DynamoDB records directly: revision, merchant lookup fields, guards, and password hashes are internal.

## Setup

Requires Node 22+ and pnpm. From backend/:

```sh
pnpm install
cp .env.example .env.local
# Configure AWS_PROFILE or local DynamoDB credentials, region and table names.
pnpm db:create
pnpm test
pnpm typecheck
pnpm build
pnpm dev
```

Provisioning creates paid AWS resources if DYNAMODB_ENDPOINT is unset. It was NOT run against AWS. It creates missing tables and validates existing schemas; it does not delete or migrate incompatible existing tables. Runtime role needs GetItem, PutItem, UpdateItem, DeleteItem and Query for these tables and Query on indexes; transaction permissions are those of constituent item operations. Provision separately with CreateTable and DescribeTable permissions. Credentials stay server-side.

## Tables and consistency

- Merchants: id.
- Deals: id; merchant_id-index.
- Reservations: id; deal_id-index, customer_id-index, merchant_id-index.
- Customers: id; unique phone guard records are claimed transactionally.

Customers is the fourth table required by the v0.6 account relation. customer_id-index replaces the provisional device_id-index. merchant_id-index supports merchant reservation lookup and used-code checks. No DynamoDB tables existed before these changes; no migration was performed.

Base reads are strongly consistent. Index queries are eventually consistent. Query returns bounded pages and nextCursor tied to the table, index and lookup value. The eventual HTTP layer must map pagination additively without renaming the contract's deals/reservations wrapper fields. Guards and billing outbox records have no GSI key attributes, so ordinary reservation queries do not return them.

## Reservation foundation

ReservationService provides reserve, cancel, confirmPickup, redeem and internal markNoShow. Its identities must come from a verified auth adapter; it is not an HTTP API. It retries conditional races after fresh reads. Errors use contract codes through DomainError. Booking starts from a live deal before pickup_end; pickup alone requires pickup_start. All persisted timestamps are normalized to UTC ISO 8601 (Z), accepting numeric-offset input. Date reporting uses America/New_York.

Booking atomically decrements quantity_left, derives sold_out, snapshots unit_price_cents/total_cents from the deal, checks blocked=false, claims a four-digit code unique among the merchant's open reservations, and increments a customer/deal unit counter bounded by max_per_customer. All writes to deals MUST increment version. Conditional stock and revision checks protect races with live edits and price drops.

Cancellation transitions reserved once, restores stock/live and releases the code and cumulative allowance. Pickup atomically checks the deal window/revision, transitions once, releases the code, and creates one durable billing usage outbox record. Customer confirm-pickup is idempotent once picked_up; merchant duplicate redemption returns CODE_ALREADY_USED. No-show transitions once after end+15 minutes, releases the open code, and increments the account count conditionally; the second blocks new bookings. No-show does not replenish already-expired inventory. Picked-up and no-show units continue to count toward the per-deal allocation; cancelled units do not.

Four-digit codes may be reused after completion, as the contract only requires open uniqueness. Used-code error detection falls back to the merchant index and therefore has eventual-consistency limits immediately after completion. Codes are not authorization. There are only 10,000 possible open codes per merchant.

publishCommand validates required prices, stock, allergens and timing, sets published_at, and optionally enforces plan gating. liveEditCommand only accepts the four contract-approved live fields, rejects price increases and inventory below allocated units, and uses a conditional revision. createDraft persists explicit nulls, normalizes timestamps, and keeps status draft. createCustomerCommand claims a unique phone and stores a hash supplied by the future auth layer.

## Verification

Unit tests cover validation, offset handling, account ownership, transaction conditions, allergens, plan gate and live edit locks. The opt-in DynamoDB Local integration test covers: 12 competing reservations for 5 units; cumulative two-unit limits under races; stock restoration once; code uniqueness and collision rollback; stored price snapshots after a price drop; cross-account/merchant actions; cancellation racing pickup; duplicate pickup billing; two simultaneous/retried no-shows blocking the account.

To run it against an in-memory DynamoDB Local instance on your machine:

```sh
DYNAMODB_TEST_ENDPOINT=http://127.0.0.1:8126 pnpm test
```

The test only permits loopback emulator URLs, uses dummy credentials, creates temporary namespaced tables and removes only its own tables afterward. Production build and typecheck do not need AWS credentials.

## Local integration update

The next phase's core HTTP/auth integration now exists. See ../../LOCAL_RUN.md for the verified run path and current remaining scope. app/api/[...path]/route.ts delegates to the HTTP adapter; the root UI route serves the built original web app on the same Next.js origin. Accounts uses salted scrypt passwords and opaque server-side sessions. Marketplace resumes cancellation cascades and due no-shows on API requests. Core authenticated API lifecycle tests now pass against DynamoDB Local.

Follows, notifications, suggestions, geocoding, AI provider and billing delivery are not implemented. Summary and donations are implemented. No AWS deployment is claimed.
