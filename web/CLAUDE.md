# [NAME] web (API + merchant portal)

A marketplace where local food businesses list a limited quantity of items for a limited time at a discount, and nearby students reserve and pick up in store. Built in one day at a hackathon; a live demo is at 8:00 PM today.

This repo is one Next.js app: the JSON API under `/api` and the merchant web portal. The consumer app is a separate Expo repo that calls this API.

## Read before writing code

- `docs/api-contract.md`: source of truth for endpoints, object shapes, state transitions and validation rules. It is frozen. Do not rename or remove fields. New fields must be optional.
- `docs/agent-spec.md`: the listing agent (`POST /api/merchants/{id}/drafts`).
- `docs/design.md`: UI rules for the portal.
- `docs/build-notes.md`: constraints from the AWS beta, decisions, open questions.

If the docs do not cover something you need, stop and ask. Do not pick a default silently.

## Stack

- Next.js (TypeScript), deployed on AWS.
- Data, file storage and model calls go through the AWS SDK.
- Hosting service, sign-in provider and model id are not decided yet (see open questions in `docs/build-notes.md`). Keep each behind one module so it can be swapped:
  - `lib/store`: data access
  - `lib/auth`: `getCurrentMerchant(request)`, `getCurrentCustomer(request)`. Today this is email/phone + password in our own store; an external provider may replace it.
  - `lib/extract`: the model call from `agent-spec.md`
  - `lib/photos`: photo upload

## Hard rules

- Do not write billing, checkout, subscription, invoice or Stripe code, and do not add a billing library. A separate tool generates that code later as a pull request. Leave `plan_status` as a plain field and `GET /api/billing/links` as a stub.
- Never commit `.npmrc`, `.env*` or any credential. `.gitignore` covers them; check before every commit.
- No second backend service. Everything server-side lives in this Next.js app.
- Money is integer cents. Times are ISO 8601 with offset; business dates are America/New_York.
- The agent never sets allergens the merchant did not state, never invents a price, never publishes.
- UI copy never says "leftover", "expiring", "waste" or "about to be thrown out".
- Code, comments, UI copy and commit messages are in English.

## Scope

In: everything in `api-contract.md`.
Out unless asked: delivery, consumer payments, admin tools, analytics, multi-city, i18n.

A teammate is integrating AWS services in parallel. Keep service-specific code inside the four `lib/` modules, and keep `docs/ARCHITECTURE.md` current when a module's interface or an environment variable changes.

## Working agreement

- Small commits, one concern each. Run type-check and tests before committing.
- Tests cover the rules in the contract's "Relations, state transitions, rules" section and the agent's build step. UI does not need tests today.
- `expired` and `no_show` are derived when a record is read. No scheduler.
- Reserving decrements `quantity_left` atomically.
- When a task is done, report what was built, what was not, and anything in the docs that turned out ambiguous.
