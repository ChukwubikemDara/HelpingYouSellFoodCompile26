# AWS

What the web app uses on AWS, how to create it, and how the DynamoDB driver lays out its data. The lead does not create AWS resources; you run the steps below in your own account.

Everything is in one CloudFormation stack (`infra/template.yaml`) plus an Amplify Hosting app you connect to the git repo in the console.

```
Browser / Expo app ──HTTPS──> Amplify Hosting (Next.js SSR, WEB_COMPUTE)
                                  │  SSR compute role <prefix>-ssr-compute
                                  ├── DynamoDB table <prefix>-main          (lib/store/dynamodb)
                                  ├── S3 bucket <prefix>-photos-<acct>-<region>, photos/* public-read (lib/photos)
                                  └── Bedrock Runtime Converse              (lib/extract)
```

No billing resources are created (CLAUDE.md). The `/monetize` tool adds its own later.

## 1. Create the stack

### Resources

| Logical id | Type | Name | Notes |
|---|---|---|---|
| `Table` | DynamoDB table | `<prefix>-main` | On-demand, point-in-time recovery on, encrypted with the AWS owned key. `DeletionPolicy: Retain`. Layout in section 4. |
| `PhotosBucket` | S3 bucket | `<prefix>-photos-<account>-<region>` | ACLs disabled (bucket owner enforced), SSE-S3, versioning on (old versions expire after 30 days). Bucket-level Block Public Access: `BlockPublicAcls` and `IgnorePublicAcls` on, `BlockPublicPolicy` and `RestrictPublicBuckets` off so the policy below can make `photos/` public. `DeletionPolicy: Retain`. |
| `PhotosBucketPolicy` | bucket policy | | Anyone may `s3:GetObject` on `photos/*`. Nothing else is public. Requests without TLS are denied. |
| `AppAccessPolicy` | IAM managed policy | `<prefix>-app-access` | DynamoDB `GetItem`, `BatchGetItem`, `Query`, `PutItem`, `UpdateItem`, `DeleteItem` on the table and its indexes (no `Scan`, no table admin). S3 `PutObject`, `GetObject` on `photos/*` only. Bedrock `InvokeModel` (what Converse needs) on foundation models matching `BedrockModelPattern`, in any region, plus this account's inference profiles for them. Optionally the AWS Marketplace agreement for the model's first use, only through Bedrock (see section 2). |
| `SsrComputeRole` | IAM role | `<prefix>-ssr-compute` | Trusted by `amplify.amazonaws.com` (the trust policy Amplify documents). Has `AppAccessPolicy`. |
| `AppRunnerInstanceRole` | IAM role | `<prefix>-apprunner-instance` | Only when `CreateAppRunnerRole=true`. Trusted by `tasks.apprunner.amazonaws.com`. Same policy. |

Parameters: `NamePrefix` (default `app`, 2 to 28 lowercase characters), `BedrockModelPattern` (default `anthropic.claude-*`), `AllowBedrockMarketplaceSubscribe` (default `true`), `CreateAppRunnerRole` (default `false`).

Outputs: `TableName`, `PhotosBucketName`, `PhotosPublicBaseUrl`, `SsrComputeRoleArn`, `AppRunnerInstanceRoleArn` (when created), `AppAccessPolicyArn`, `Region`.

### Before you deploy

- Pick a region where your Bedrock model is offered (for example `us-east-1`). Create the stack, the Amplify app and the model access in that region.
- Check account-level S3 Block Public Access: S3 console > Block Public Access settings for this account. If "Block public access to buckets and objects granted through new public bucket policies" is on for the account, the bucket policy cannot be created and the stack fails at `PhotosBucketPolicy`. Either turn off the two policy-related settings for the account (this affects every bucket in the account), or keep the bucket private and serve photos through CloudFront with `PHOTOS_PUBLIC_BASE_URL` (not in this template).
- Optional local check: `pip install cfn-lint && cfn-lint infra/template.yaml`. The repo's offline test (`tests/store/dynamodb-template.test.ts`) checks references and the table layout, not resource property schemas.

### With the AWS CLI

```bash
aws cloudformation deploy \
  --region us-east-1 \
  --stack-name app-web \
  --template-file infra/template.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides NamePrefix=app

aws cloudformation describe-stacks --region us-east-1 --stack-name app-web \
  --query "Stacks[0].Outputs" --output table
```

Add `CreateAppRunnerRole=true` to `--parameter-overrides` for the Docker fallback. `CAPABILITY_NAMED_IAM` is needed because the role and policy have fixed names.

### In the console

CloudFormation > Stacks > Create stack > With new resources (standard) > Template is ready > Upload a template file > choose `infra/template.yaml` > Next. Stack name `app-web`, keep or change the parameters > Next > Next. Tick "I acknowledge that AWS CloudFormation might create IAM resources with custom names" > Submit. When the stack is `CREATE_COMPLETE`, the Outputs tab has the values for section 3.

### Deleting

The table and bucket are retained when the stack is deleted, so data survives a mistaken delete. To remove them: delete the table in the DynamoDB console, then empty the bucket (S3 console > Empty, which also removes old versions) and delete it. A new stack with the same `NamePrefix` fails while the retained table or bucket still exists.

## 2. Turn on the Bedrock model

Bedrock serverless models are available without a separate "model access" request, with two steps for Anthropic models:

1. **First-time-use form (once per account, or once in the organization's management account).** Bedrock console > Model catalog > choose the Anthropic model > fill in the use-case details when asked (company, website, intended users, use case). Access is granted right after submission.
2. **Marketplace agreement (once per account).** The first call to the model creates an AWS Marketplace agreement, and the caller needs `aws-marketplace:Subscribe` and `aws-marketplace:ViewSubscriptions` for that call. Either:
   - keep `AllowBedrockMarketplaceSubscribe=true` (default): the app role may accept it, only through Bedrock (`aws:CalledViaLast = bedrock.amazonaws.com`); or
   - set it to `false` and make one call yourself as an admin first, for example in Bedrock console > Playgrounds > Chat with the model, or:

     ```bash
     aws bedrock-runtime converse --region us-east-1 --model-id <LISTING_MODEL_ID> \
       --messages '[{"role":"user","content":[{"text":"Reply with OK."}]}]' \
       --inference-config '{"maxTokens":8}'
     ```

`LISTING_MODEL_ID`: copy the id from the Bedrock console. Current Claude models are usually called through a cross-region inference profile (Bedrock console > Cross-region inference, an id shaped like `us.anthropic.<model>`); an in-region foundation-model id (`anthropic.<model>`) also works where the model is offered on demand. The policy allows both for models matching `BedrockModelPattern`; set the parameter to the exact model id if you want the policy narrower. The listing agent needs a model that accepts images and tool use (agent-spec.md).

Leave `LISTING_MODEL_TEMPERATURE` unset unless the chosen model accepts a non-default temperature, and leave `LISTING_TOOL_CHOICE` at its default (`auto`) unless the model accepts a forced tool choice.

## 3. Hosting on Amplify

The ordered runbook, with checks and troubleshooting, is `docs/DEPLOY.md`. In short:

1. Push the repo to GitHub (or another Amplify-supported git host). Never push `.npmrc` or `.env*`.
2. Amplify console > Create new app > choose the git provider > repository and branch > Next.
3. Build settings: the app is detected as Next.js SSR, and Amplify uses `amplify.yml` from the repo root. Keep it. It builds with Node 22, checks the driver variables (a missing table, bucket or model id fails the build), refuses values with `#` or `$`, and writes the runtime variables below to `.env.production` during the build, because Amplify gives console variables to the build only and Next.js server code reads them at runtime from that file.
4. Advanced settings > Environment variables: add the variables from the table in section 5 (at least `STORE_DRIVER`, `DYNAMODB_TABLE`, `APP_AWS_REGION`, `PHOTOS_DRIVER`, `PHOTOS_BUCKET`, `LISTING_MODEL_PROVIDER`, `LISTING_MODEL_ID`). None of them are secrets.
5. Save and deploy. Then App settings > IAM roles > Compute role > Edit > Default role: `<prefix>-ssr-compute` (output `SsrComputeRoleArn`) > Save. The role takes effect without a redeploy. For a public repo with branch auto-creation or PR previews, attach the role to the production branch only.
6. The app URL is on the app's overview page (`https://<branch>.<app-id>.amplifyapp.com`). That is the API base for the Expo app (`<url>/api`).

Logs of the server code: Amplify console > the app > Hosting > Monitoring > Hosting compute logs (CloudWatch).

### Fallback: one container

```bash
docker build --platform linux/amd64 -t web .     # root Dockerfile, from the repo root; needs BuildKit (Docker 23+)
```

Push the image to an ECR repository and run it on App Runner (only for accounts that already use App Runner, which is closed to new customers) or ECS Express Mode: port `8080`, health check `/api/health`, the role `<prefix>-apprunner-instance` (stack parameter `CreateAppRunnerRole=true`) or an ECS task role with `<prefix>-app-access`, and the environment variables from section 5 (passed at runtime; no `.env.production`). Steps: `docs/DEPLOY.md` section 12. The image never contains credentials, `.env*`, `.npmrc`, `docs/` or `CLAUDE.md` (root `.dockerignore`).

## 4. DynamoDB layout

One table. Base key: `PK` (string, partition) and `SK` (string, sort). Four global secondary indexes, each with string keys `GSIn PK`/`GSIn SK` named `GSI1PK`/`GSI1SK` ... `GSI4PK`/`GSI4SK`, projection ALL. The indexes are overloaded: different item types put different values in the same index. Source of truth: `lib/store/dynamodb/schema.ts` (`tableDefinition()`, `keys`, `indexKeys`); a test checks that `infra/template.yaml` matches it.

Conventions:

- Record fields are stored as top-level attributes under their record names. Nullable fields are stored as DynamoDB `NULL`, never left out. Lists (`items`, `menu`, `allergens`) are lists.
- Key and index attributes are upper case. Driver-internal attributes start with `_`. Reads drop both, so a record field added later round-trips with no driver change.
- Every item has `_type` (for people reading the table).
- Variable parts of keys are escaped (`%` -> `%25`, `#` -> `%23`) so composite keys stay unambiguous.
- Time sort keys are `<utcKey(t)>#<id>`, for example `2026-10-11T20:10:00.000Z#r_x7Pq`. `utcKey` is always 24 characters of UTC, so string order is time order across DST offsets. "Strictly after t" is the key condition `SK > utcKey(t) + "$"` (`$` sorts after `#`).

### Item types

| Item | PK | SK | Index keys | Attributes |
|---|---|---|---|---|
| Merchant account | `ACCOUNT#<id>` | `ACCOUNT` | | `MerchantAccountRecord` |
| Email marker | `EMAIL#<email>` | `EMAIL` | | `account_id` |
| Merchant session | `MSESSION#<id>` | `MSESSION` | | `MerchantSessionRecord` (`id` is the hash lib/auth chooses) |
| Customer | `CUSTOMER#<id>` | `CUSTOMER` | | `CustomerRecord` |
| Phone marker | `PHONE#<phone>` | `PHONE` | | `customer_id` |
| Customer token | `CTOKEN#<id>` | `CTOKEN` | | `CustomerTokenRecord` |
| Merchant | `MERCHANT#<id>` | `MERCHANT` | | `MerchantRecord` |
| Owner marker | `OWNER#<account_id>` | `OWNER` | | `merchant_id` (one merchant per account) |
| Deal | `DEAL#<id>` | `DEAL` | GSI1 `MERCHANT#<m>#DEALS` / `<created>#<id>`; GSI2 `MERCHANT#<m>#DEALS#<local_date>` / `<created>#<id>`; GSI3 `OPEN_DEALS` / `<pickup_end>#<id>` only while stored status is `live` and `pickup_end` is set (sparse) | `DealRecord`, plus internal `_pek` (utcKey of `pickup_end`), `_q#<customer_id>` (that customer's reserved + picked-up quantity), `_o#<reservation_id>` (a reservation made on the deal and not cancelled) |
| Reservation | `RES#<id>` | `RES` | GSI1 `CUSTOMER#<c>#RES`; GSI2 `DEAL#<d>#RES`; GSI3 `MERCHANT#<m>#RES#<local_date>`; GSI4 `MERCHANT#<m>#CODE#<code>`; all sorted `<created>#<id>` | `ReservationRecord` |
| Pickup code lock | `CODE#<merchant_id>#<code>` | `CODE` | | `reservation_id`, `deal_id`, `created_at`. Exists exactly while that reservation's stored status is `reserved`. |
| Follow | `FOLLOW#<customer_id>` | `M#<merchant_id>` | GSI1 `MERCHANT#<m>#FOLLOWERS` / `C#<customer_id>` | `customer_id`, `merchant_id`, `created_at` |
| Notification | `NOTIF#<id>` | `NOTIF` | GSI1 `CUSTOMER#<c>#NOTIF` / `<created>#<id>` | `NotificationRecord` |
| Notification dedupe marker | `NDEDUPE#<customer_id>#<dedupe_key>` | `NDEDUPE` | | `notification_id` |
| Suggestion state | `SUGG#<merchant_id>` | `S#<id>` | | `SuggestionStateRecord` |

### Access patterns

No request path uses Scan (a test asserts it).

| Store method | Served by | Consistency |
|---|---|---|
| `get*` by id (account, session, customer, token, merchant, deal, reservation, notification, suggestion state) | GetItem on the base key | strong |
| `getMerchantAccountByEmail`, `getCustomerByPhone`, `getMerchantByOwner` | GetItem on the marker, then GetItem on the entity | strong |
| `getCustomersByIds`, `getMerchantsByIds`, `getDealsByIds` | BatchGetItem (100 keys per call, unprocessed keys retried) | strong |
| `listDealsByMerchant(m, {limit})` | Query GSI1 `MERCHANT#<m>#DEALS`, descending, `Limit` | eventual |
| `listDealsByMerchantDate(m, date)` | Query GSI2 `MERCHANT#<m>#DEALS#<date>`, descending | eventual |
| `listOpenDeals({pickupEndAfter})` | Query GSI3 `OPEN_DEALS` with `GSI3SK > utcKey(after)$`, ascending | eventual |
| `listReservationsByCustomer(c)` | Query GSI1 `CUSTOMER#<c>#RES`, descending | eventual |
| `listReservationsByDeal(d)` | Query GSI2 `DEAL#<d>#RES`, descending | eventual |
| `listReservationsByMerchantDate(m, date)` | Query GSI3 `MERCHANT#<m>#RES#<date>`, descending | eventual |
| `findReservationsByPickupCode(m, code)` | Query GSI4 `MERCHANT#<m>#CODE#<code>` plus GetItem on the code lock, then BatchGetItem of every id found | strong for the open reservation and every status |
| `listFollowedMerchantIds(c)` | Query base partition `FOLLOW#<c>`, sorted by `created_at` in code | strong |
| `listFollowerIds(m)` | Query GSI1 `MERCHANT#<m>#FOLLOWERS` | eventual |
| `listNotificationsByCustomer(c, {since})` | Query GSI1 `CUSTOMER#<c>#NOTIF`, descending, `GSI1SK > utcKey(since)` (every key that starts with that instant is greater, so this is "created at or after `since`") | eventual |
| `listSuggestionStates(m)` | Query base partition `SUGG#<m>` | strong |

"Eventual" means a write from the last fraction of a second may be missing from that list. Nothing atomic depends on an index read. Services should take a live deal's reserved units from `quantity_total - quantity_left`, not by counting `listReservationsByDeal`.

### Writes and transactions

Conditions on every write mirror the in-memory driver; a failed condition comes back as the same `{ ok: false, reason }`.

| Operation | DynamoDB calls |
|---|---|
| `createMerchantAccount`, `createCustomer`, `createMerchant` | TransactWriteItems: Put entity + Put marker, both `attribute_not_exists(PK)`. Marker taken -> `EMAIL_TAKEN` / `PHONE_TAKEN` / `OWNER_HAS_MERCHANT`. |
| `createDeal`, sessions, tokens, notifications without a dedupe key | PutItem with `attribute_not_exists(PK)`. Deals start at version 1 with their index keys. |
| `createNotification` with a dedupe key | TransactWriteItems: Put notification + Put `NDEDUPE` marker. Marker taken -> the existing notification, `created: false`. |
| `updateDeal(id, patch, {ifVersion})` | GetItem, then UpdateItem `SET` of the patched fields, `version + 1`, and the GSI3 keys and `_pek` recomputed from the new status and `pickup_end`; condition `version = <read version>`. Stale `ifVersion` -> `VERSION_CONFLICT`. Without `ifVersion` it re-reads and retries. |
| `updateMerchant`, `updateCustomer`, `markNotificationRead` | UpdateItem `SET`, condition `attribute_exists(PK)`, `ReturnValues ALL_NEW`; missing -> `null`. |
| `reserve` | GetItem deal, checks in the contract order, then **one** TransactWriteItems: (1) Update deal: `quantity_left - q`, `version + 1`, `_q#<c> + q`, set `_o#<r>`; condition `status = live AND _pek > utcKey(at) AND quantity_left >= q AND deal_price_cents = <read price> AND max_per_customer = <read max> AND (_q#<c> missing OR _q#<c> <= max - q)`. (2) Put reservation (`unit_price_cents` = the read price). (3) Put code lock `attribute_not_exists`. Deal condition failed -> re-read and report `DEAL_NOT_LIVE` / `SOLD_OUT` / `MAX_PER_CUSTOMER` (or retry if only the price moved). Code lock failed -> `PICKUP_CODE_TAKEN`. |
| `cancelReservation` | TransactWriteItems: Update reservation to `cancelled` (condition `status = reserved`); Update deal `quantity_left + q`, `version + 1`, `_q#<c> - q`, remove `_o#<r>`; Delete code lock (condition: held by this reservation or absent). |
| `markReservationPickedUp` | TransactWriteItems: Update reservation to `picked_up` (condition `status = reserved`); Delete code lock. The deal is not written; its `_o#` marker stays and is ignored once the reservation is not `reserved`. |
| `cancelDeal` | GetItem deal, BatchGetItem the reservations named by `_o#` markers, then TransactWriteItems: Update deal to `cancelled` (condition `version = <read>`; leaves GSI3; markers removed; `_q#` quantities returned) + for each `reserved` reservation an Update to `cancelled` (condition `status = reserved`) and a Delete of its code lock. Any change since the read cancels the transaction and it starts over. |
| `addFollow` / `removeFollow`, `putSuggestionState` | PutItem (follow: `attribute_not_exists`, a repeat keeps the first time) / DeleteItem; PutItem replaces. |

Limits and retries:

- A transaction holds at most 100 actions, so `cancelDeal` cancels up to 49 open reservations atomically with the deal. With more, the deal and the first 49 commit together (no new reservation can be made from then on), and the rest are cancelled in follow-up transactions of 50, skipping any that were picked up or cancelled in between.
- Transaction conflicts and throttling cancellations are retried with jittered backoff (8 times). An operation that keeps losing races (the item changed between its read and its write) re-reads up to 12 times, then throws.
- The SDK sends an idempotency token with TransactWriteItems, so its own network retries do not double-apply. A PutItem whose first response was lost and whose retry finds the identical item counts as success.
- GSI3's `OPEN_DEALS` is one index partition: fine for one city (an index partition handles about 1,000 writes and 3,000 reads per second).

## 5. Environment variables (AWS side)

| Name | Read by | Purpose | Example | Required |
|---|---|---|---|---|
| `STORE_DRIVER` | lib/config | `dynamodb` on AWS; `memory` keeps data in one process only | `dynamodb` | optional; unset means `dynamodb` in production and `memory` elsewhere. Set it explicitly on AWS |
| `DYNAMODB_TABLE` | lib/store | Table name (output `TableName`) | `app-main` | required when `STORE_DRIVER=dynamodb` |
| `DYNAMODB_ENDPOINT` | lib/store | Local emulator endpoint. Loopback endpoints get dummy credentials. Never set on AWS | `http://127.0.0.1:4567` | optional |
| `APP_AWS_REGION` | lib/env (every AWS client) | Region of the stack (output `Region`). Amplify reserves the `AWS_` prefix for user variables | `us-east-1` | recommended; falls back to `AWS_REGION` |
| `AWS_REGION` | lib/env | Fallback region; the Lambda and App Runner runtimes set it | `us-east-1` | optional |
| `PHOTOS_DRIVER` | lib/config | `s3` on AWS (`local` writes to the server's disk, which Amplify compute does not keep) | `s3` | optional; unset means `s3` in production and `local` elsewhere. Set it explicitly on AWS |
| `PHOTOS_BUCKET` | lib/photos | Bucket name (output `PhotosBucketName`); objects go under `photos/` | `app-photos-123456789012-us-east-1` | required when `PHOTOS_DRIVER=s3` |
| `PHOTOS_PUBLIC_BASE_URL` | lib/photos | Base of public photo URLs, e.g. a CloudFront domain; default is the bucket's regional S3 URL | `https://d123.cloudfront.net` | optional |
| `LISTING_MODEL_PROVIDER` | lib/config | `bedrock` on AWS (`fake` is the local rule-based extractor) | `bedrock` | optional; unset means `bedrock` in production and `fake` elsewhere. Set it explicitly on AWS |
| `LISTING_MODEL_ID` | lib/extract | Bedrock model or inference profile id (section 2) | `us.anthropic.<model>` | required for `bedrock` |
| `LISTING_MODEL_TEMPERATURE` | lib/extract | Sent only when set | `0` | optional |
| `LISTING_TOOL_CHOICE` | lib/extract | `tool` forces the tool; default `auto` | `tool` | optional |
| `LISTING_MODEL_EXTRA_FIELDS` | lib/extract | JSON object sent as `additionalModelRequestFields` (no `$` or newlines, it passes through `.env.production`) | `{}` | optional |
| `PLAN_GATE`, `SEED_ON_START` | lib/services | App switches (see docs/ARCHITECTURE.md); `amplify.yml` passes them through too | `1` | optional |
| `DYNAMODB_IT_TABLE` | tests/store/dynamodb.test.ts | Opt-in: run the Store conformance suite against this real table. The suite writes test records and never deletes them, so use a throwaway stack (e.g. `NamePrefix=app-it`), never production | `app-it-main` | optional, tests only |
| `NEXT_OUTPUT` | next.config.ts | `standalone` for the Docker image; the root `Dockerfile` sets it | `standalone` | Docker only |

This table covers the AWS side. The full list, including the dev and test switches (`PHOTOS_LOCAL_DIR`, `E2E_HOOKS`, `E2E_BASE_URL`, `NEXT_DIST_DIR`), is in `docs/ARCHITECTURE.md` "Environment variables". Never set `E2E_HOOKS`, `DYNAMODB_ENDPOINT` or `PHOTOS_LOCAL_DIR` on AWS.

AWS credentials are never environment variables you set: Amplify and App Runner provide the role's temporary credentials to the SDK's default chain.

## 6. Testing the driver

- `npm test` runs `tests/store/dynamodb.test.ts`: the full Store conformance suite against dynalite started in-process, plus driver checks (open-deals index upkeep through publish, edits and cancel; `cancelDeal` beyond one transaction; no Scan; `getStore()` wiring).
- dynalite 4 has no `TransactWriteItems`. The test client emulates it (`tests/store/dynamodb-emulator.ts`): every request runs one at a time, each action of a transaction runs against dynalite with its real condition expression, and if any condition fails all applied actions are rolled back and the client gets `TransactionCanceledException` with per-action `CancellationReasons`, as DynamoDB sends them. The concurrency tests (last unit, 8 reserves for 3 units, same-code races, concurrent signups) therefore exercise the driver's conditions and failure mapping. What it cannot show is DynamoDB's own `TransactionConflict` under real contention; to cover that, run the suite against a real throwaway table:

  ```bash
  DYNAMODB_IT_TABLE=app-it-main APP_AWS_REGION=us-east-1 npx vitest run tests/store/dynamodb.test.ts
  ```

- Because dynalite lacks transactions, the running app cannot use `STORE_DRIVER=dynamodb` against plain dynalite. Develop locally with `STORE_DRIVER=memory`, or point at a real table.
- `tests/store/dynamodb-template.test.ts` parses `infra/template.yaml` offline: same table as the driver, every `Ref`/`GetAtt`/`Sub`/`Condition` resolves, the app policy has exactly the driver's DynamoDB actions and no wildcards, only `photos/*` is public, and Amplify can assume the compute role.
