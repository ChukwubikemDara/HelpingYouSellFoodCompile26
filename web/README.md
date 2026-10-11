# web

One Next.js 15 app: the JSON API under `/api` and the merchant web portal. The consumer Expo app calls the same API.

- `CLAUDE.md`: rules for working in this repo.
- `docs/api-contract.md`: API source of truth (v0.6).
- `docs/ARCHITECTURE.md`: modules, interfaces, environment variables.
- `docs/DEPLOY.md` and `docs/AWS.md`: deploying to AWS (Amplify Hosting, DynamoDB, S3, Bedrock).

## Run locally

Requires Node.js 20.9 or newer (22 recommended). Local dev needs no AWS account: outside production the drivers default to the in-memory store, local photo files and the rule-based stand-in for the listing model (`lib/config.ts`).

```
npm install
SEED_ON_START=1 npm run dev     # http://localhost:3000, with demo data
```

`SEED_ON_START=1` loads one merchant (`demo-merchant@example.com` / `demo-merchant-pass`, sign in at `/signin`), two live deals and one customer (`+18145550123` / `demo-customer-pass`). Data lives in the server process and is lost on restart. `GET /api/health` returns `{"ok": true}`.

## Checks

```
npm run typecheck
npm test                                        # unit and route tests (no AWS)
npm run lint
E2E_HOOKS=1 npm run dev                         # in one terminal
npm run e2e -- http://localhost:3000            # in another: end-to-end check through the API
bash scripts/curl-flows.sh http://localhost:3000   # needs SEED_ON_START=1 on the server
```

`scripts/e2e.ts` plays the merchant and three customers through the public API and checks every response against the contract's object shapes. It prints one line per step and exits 0 when nothing failed. It can run any number of times against the same server. The blocked-customer step uses a test-only hook that exists only when the server runs with `E2E_HOOKS=1` outside production; against any other server that step is reported as SKIP.

## Production

`npm run build && npm start` runs with `NODE_ENV=production`, where the drivers default to DynamoDB, S3 and Bedrock. The server stops at startup and names the missing variable when `DYNAMODB_TABLE`, `PHOTOS_BUCKET` or `LISTING_MODEL_ID` is not set. To try a production build without AWS, choose the local drivers explicitly:

```
STORE_DRIVER=memory PHOTOS_DRIVER=local LISTING_MODEL_PROVIDER=fake npm start
```

Never commit `.env*` or `.npmrc`.
