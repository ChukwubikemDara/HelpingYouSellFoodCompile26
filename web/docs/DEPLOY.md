# Deploy (W7)

How to put the web app (API + merchant portal) on AWS, in order. You run every step in your own AWS account; nothing has been deployed or created for you. Expect about 45 minutes the first time, most of it waiting for CloudFormation and the first Amplify build.

```
Expo app / browser ──HTTPS──> Amplify Hosting (Next.js 15 SSR, WEB_COMPUTE, Node 22)
                                │  SSR compute role <prefix>-ssr-compute (temporary credentials)
                                ├── DynamoDB table <prefix>-main               STORE_DRIVER=dynamodb
                                ├── S3 bucket <prefix>-photos-<acct>-<region>   PHOTOS_DRIVER=s3
                                └── Bedrock Runtime (Converse)                  LISTING_MODEL_PROVIDER=bedrock
```

Files this uses: `infra/template.yaml` (the stack), `amplify.yml` (Amplify build spec, repo root), `Dockerfile` + `.dockerignore` (fallback), `.env.example` (every variable). Background on the stack and the table layout: `docs/AWS.md`. Code layout and interfaces: `docs/ARCHITECTURE.md`.

Steps:

1. [Check the facts this plan relies on](#1-facts-this-plan-relies-on)
2. [Create the CloudFormation stack](#2-create-the-cloudformation-stack)
3. [Turn on the Bedrock model](#3-turn-on-the-bedrock-model)
4. [Push the repo to a private GitHub repo](#4-push-the-repo-to-a-private-github-repo)
5. [Create the Amplify app](#5-create-the-amplify-app)
6. [Set the environment variables](#6-environment-variables)
7. [Deploy and check `/api/health`](#7-deploy-and-check)
8. [Seed the demo data from your laptop](#8-seed-the-demo-data)
9. [Point the mobile app at the API](#9-point-the-mobile-app-at-the-api)
10. [Check the listing agent on the real model](#10-check-the-listing-agent-on-the-real-model)
11. [Troubleshooting](#11-troubleshooting)
12. [Fallback: one container (App Runner, or ECS Express Mode)](#12-fallback-one-container)
13. [W8 checklist: billing by hand](#13-w8-checklist-billing-by-hand)

## 1. Facts this plan relies on

Checked against the AWS docs on Oct 11, 2026. Sources are listed at the end ([Sources](#sources)).

| Fact | Consequence here |
|---|---|
| Amplify Hosting compute runs Next.js SSR apps for Next.js 12 through 15 [1][2]. | The app is on Next.js 15.5 (App Router). Do not upgrade to 16 before the demo. |
| "Middleware" is listed as supported; "Edge API Routes (Edge middleware is not supported)", Next.js streaming and `unstable_after` are listed as unsupported [1]. | `middleware.ts` (CORS for the consumer endpoints) only uses `NextResponse`. No route uses the edge runtime, streaming or `after`. Step 7 checks the CORS preflight on the deployed app. |
| The SSR runtime uses the Node.js major version the app was built with; supported runtimes are Node.js 20, 22 and 24 [3]. | `amplify.yml` runs `nvm install 22 && nvm use 22` and checks the version. |
| A Next.js server does not see Amplify console environment variables at runtime; the build spec must write them to `.env.production` [4]. Do not put secrets there: anyone with access to the build artifacts can read them [4]. | `amplify.yml` writes a fixed list of variable names (`RUNTIME_VARS`) to `.env.production`. Changing a variable needs a new build. All our variables are names and switches; AWS credentials come from the compute role. |
| Amplify does not allow variable names with the `AWS` prefix; values are at most 5500 characters [5]. | Region is `APP_AWS_REGION` (the code falls back to `AWS_REGION`, which the runtime sets itself). |
| An SSR compute role gives the server temporary credentials; its trust policy must allow `amplify.amazonaws.com`; it can be changed without a redeploy; for a public repo with branch previews, attach it per branch [6]. `UpdateApp` takes `computeRoleArn` and `platform` (`WEB`, `WEB_DYNAMIC`, `WEB_COMPUTE`) [7]. | The stack creates `<prefix>-ssr-compute` with that trust policy. |
| Build output limit: the troubleshooting page says 220 MB for SSR apps [8]; the features page still says 50 MB per SSR deployment [3]. Response bodies over 5.72 MB return 504 [8]. | Measured on this repo (`next build`, standalone trace): 86 MB with sharp's native binaries, 49 MB without them (Amplify deploys sharp itself [1]), 8.4 MB compressed. Responses are small JSON. See [Troubleshooting](#11-troubleshooting) if Amplify refuses the size. |
| App Runner is closed to new customers since April 30, 2026; existing customers keep using it. AWS recommends ECS Express Mode instead [9][10]. App Runner's managed Node runtime is `nodejs22` [11]. | The fallback is a container image (root `Dockerfile`). Use App Runner only if your account already uses it; otherwise ECS Express Mode with the same image. |

## 2. Create the CloudFormation stack

One stack creates the DynamoDB table, the photos bucket (only `photos/*` is public), the app's IAM policy and the Amplify compute role. Details of every resource: `docs/AWS.md` section 1.

Pick one region for everything (stack, Bedrock model, Amplify app), for example `us-east-1`. Then:

1. Check account-level S3 Block Public Access: S3 console > "Block Public Access settings for this account". If "Block public access to buckets and objects granted through new public bucket policies" is on, the stack fails at `PhotosBucketPolicy`. Turn off the two policy-related settings for the account, or plan to serve photos through CloudFront (not in the template).
2. Create the stack, with the AWS CLI:

   ```bash
   aws login            # or any credentials with admin rights in the account
   aws cloudformation deploy \
     --region us-east-1 \
     --stack-name app-web \
     --template-file infra/template.yaml \
     --capabilities CAPABILITY_NAMED_IAM \
     --parameter-overrides NamePrefix=app
   aws cloudformation describe-stacks --region us-east-1 --stack-name app-web \
     --query "Stacks[0].Outputs" --output table
   ```

   Or in the console: CloudFormation > Create stack > With new resources (standard) > Upload a template file > `infra/template.yaml` > stack name `app-web`, parameters as they are > tick "I acknowledge that AWS CloudFormation might create IAM resources with custom names" > Submit. Wait for `CREATE_COMPLETE`.

3. Write down the outputs: `TableName`, `PhotosBucketName`, `SsrComputeRoleArn`, `Region` (and `AppAccessPolicyArn` for the fallback).

Parameters you may change: `NamePrefix` (default `app`), `BedrockModelPattern` (default `anthropic.claude-*`, narrows which models the app may call), `AllowBedrockMarketplaceSubscribe` (default `true`, see step 3), `CreateAppRunnerRole` (default `false`, see step 12). The table and the bucket are kept when the stack is deleted (`docs/AWS.md`, "Deleting").

## 3. Turn on the Bedrock model

The listing agent needs a model that accepts images and tool use (`docs/agent-spec.md`). Details: `docs/AWS.md` section 2.

1. Bedrock console (same region) > Model catalog > choose the Anthropic Claude model. If asked, fill in the first-time-use form (company, use case); access is granted right after.
2. Copy the id to use as `LISTING_MODEL_ID`. Current Claude models are usually called through a cross-region inference profile (an id like `us.anthropic.<model>`; Bedrock console > Cross-region inference); an in-region model id (`anthropic.<model>`) works where the model is offered on demand.
3. The first call to a model accepts its AWS Marketplace agreement. With `AllowBedrockMarketplaceSubscribe=true` (default) the app's role may do that on its first call. To do it yourself instead:

   ```bash
   aws bedrock-runtime converse --region us-east-1 --model-id "$LISTING_MODEL_ID" \
     --messages '[{"role":"user","content":[{"text":"Reply with OK."}]}]' \
     --inference-config '{"maxTokens":8}'
   ```

4. Leave `LISTING_MODEL_TEMPERATURE` and `LISTING_TOOL_CHOICE` unset: current Claude models on Bedrock reject a non-default temperature, and some reject a forced tool choice.

## 4. Push the repo to a private GitHub repo

`docs/build-notes.md` contains details AWS marks confidential. The repo must be **private**, and must stay private (also after the `/monetize` pull request).

1. Check that no secret is tracked, in the tree or in history. Both commands must print nothing:

   ```bash
   git ls-files | grep -E '(^|/)\.env|\.npmrc$|\.pem$'
   git log --all --name-only --format= | sort -u | grep -E '(^|/)\.env|\.npmrc$|\.pem$'
   ```

2. Create the private repo and push (the product name is not decided; `web` is a neutral name):

   ```bash
   gh repo create web --private --source . --remote origin --push
   ```

   Without the GitHub CLI: github.com > New repository > Private > create it empty, then `git remote add origin git@github.com:<you>/web.git && git push -u origin main`.

3. When Amplify asks to install its GitHub App, choose "Only select repositories" and pick this one.

## 5. Create the Amplify app

1. Amplify console (same region) > Create new app > GitHub > authorize > pick the repo and branch `main` > Next.
2. App settings: Amplify detects Next.js SSR and uses `amplify.yml` from the repo root (the build settings preview shows it). Keep it.
3. Advanced settings > Environment variables: add the variables from [step 6](#6-environment-variables). If the console offers to create a service role for SSR logging, accept it (it lets Amplify write the server logs to CloudWatch [3]).
4. Save and deploy. The first build takes a few minutes.
5. Attach the compute role: App settings > IAM roles > Compute role > Edit > Default role: `<prefix>-ssr-compute` (output `SsrComputeRoleArn`) > Save [6]. With the AWS CLI:

   ```bash
   aws amplify update-app --region us-east-1 --app-id <app-id> --compute-role-arn <SsrComputeRoleArn>
   ```

6. Check the platform is `WEB_COMPUTE` (it is set when Amplify detects SSR):

   ```bash
   aws amplify get-app --region us-east-1 --app-id <app-id> --query app.platform
   ```

   If it says `WEB`, the app was detected as static. Fix it, then redeploy:

   ```bash
   aws amplify update-app --region us-east-1 --app-id <app-id> --platform WEB_COMPUTE
   aws amplify update-branch --region us-east-1 --app-id <app-id> --branch-name main --framework "Next.js - SSR"
   ```

The app URL is on the app's overview page: `https://main.<app-id>.amplifyapp.com`.

## 6. Environment variables

Set these in the Amplify console (App settings > Environment variables), then redeploy: `amplify.yml` copies them into `.env.production` during the build, so a change takes effect only after a new build. None of them is a secret. Every variable the code reads is in `.env.example`.

| Name | Value | Where the value comes from | Required |
|---|---|---|---|
| `STORE_DRIVER` | `dynamodb` | fixed | yes (unset means `dynamodb` in production; set it anyway. `memory` loses data and is not shared between server instances) |
| `DYNAMODB_TABLE` | e.g. `app-main` | stack output `TableName` | yes (without it the build fails, and the server would stop at startup) |
| `APP_AWS_REGION` | e.g. `us-east-1` | stack output `Region` | yes, recommended (falls back to the runtime's `AWS_REGION`) |
| `PHOTOS_DRIVER` | `s3` | fixed | yes (unset means `s3` in production; set it anyway. `local` cannot keep files on Amplify; drafts then get `photo_url: null`) |
| `PHOTOS_BUCKET` | e.g. `app-photos-123456789012-us-east-1` | stack output `PhotosBucketName` | yes (without it the build fails, and the server would stop at startup) |
| `LISTING_MODEL_PROVIDER` | `bedrock` | fixed | yes (unset means `bedrock` in production; set it anyway) |
| `LISTING_MODEL_ID` | model or inference profile id | Bedrock console, step 3 | yes (without it the build fails, and the server would stop at startup) |
| `PHOTOS_PUBLIC_BASE_URL` | unset | only with CloudFront in front of the bucket | no |
| `LISTING_MODEL_TEMPERATURE` | unset | only if your model accepts a temperature | no |
| `LISTING_TOOL_CHOICE` | unset (`auto`) | `tool` only if your model accepts a forced tool | no |
| `LISTING_MODEL_EXTRA_FIELDS` | unset | JSON object for `additionalModelRequestFields`; no `#` or `$` | no |
| `PLAN_GATE` | unset (off) | `1` turns on `PLAN_REQUIRED` at publish; keep off tonight (W8) | no |
| `SEED_ON_START` | unset | memory store only; on AWS seed with step 8 | no |

Never set on Amplify: `NEXT_DIST_DIR`, `NEXT_OUTPUT` (local build switches; the build ignores them), `DYNAMODB_ENDPOINT`, `PHOTOS_LOCAL_DIR`, `E2E_HOOKS` (test-only; always off in production), and any `AWS_*` name (reserved; credentials come from the compute role).

A URL before the stack exists (smoke test only): set `STORE_DRIVER=memory`, `PHOTOS_DRIVER=local` and `LISTING_MODEL_PROVIDER=fake` explicitly. In production an unset driver means the AWS one, so without these three the build stops and asks for the table, bucket and model id. Data then lives in one server instance's memory: replace them with the table above before anyone uses the app.

With the AWS CLI (this replaces the app's whole variable map):

```bash
aws amplify update-app --region us-east-1 --app-id <app-id> --environment-variables \
STORE_DRIVER=dynamodb,DYNAMODB_TABLE=<TableName>,APP_AWS_REGION=<Region>,PHOTOS_DRIVER=s3,PHOTOS_BUCKET=<PhotosBucketName>,LISTING_MODEL_PROVIDER=bedrock,LISTING_MODEL_ID=<model-id>
aws amplify start-job --region us-east-1 --app-id <app-id> --branch-name main --job-type RELEASE
```

The build log prints the names (not the values) it wrote to `.env.production`, then any `WARNING:` or `ERROR:` lines from the configuration check.

## 7. Deploy and check

After the build is green and the compute role is attached:

```bash
URL=https://main.<app-id>.amplifyapp.com
curl -s "$URL/api/health"      # {"ok":true}            the server runs
curl -s "$URL/api/deals"       # {"deals":[]} or deals   DynamoDB works (role, table, region)
curl -s "$URL/api/nope"        # {"error":{"code":"NOT_FOUND",...}}
curl -si -X OPTIONS "$URL/api/reservations" -H 'Origin: https://example.com' \
  -H 'Access-Control-Request-Method: POST' | head -5   # 204 + access-control-allow-origin: *
```

`/api/health` does not touch AWS; `/api/deals` reads the table. The preflight matters only for Expo web (native Expo Go requests are not subject to CORS). A 500 with `{"error":{"code":"INTERNAL",...}}` on `/api/deals` means the server cannot reach the table: see [Troubleshooting](#11-troubleshooting).

Then open `$URL/signup` in a browser, create a merchant account, finish onboarding and create one listing by text. That exercises the session cookie (HTTPS only in production), DynamoDB writes, Bedrock and, with a photo, S3.

## 8. Seed the demo data

`npm run seed` writes the demo merchant, its bakery, two live deals and a demo customer through the same Store code the server uses. Run it from your laptop against the deployed table, with credentials allowed to write to it (an admin `aws login` is enough):

```bash
npm ci                                   # once
aws login                                # or AWS_PROFILE=<profile>
STORE_DRIVER=dynamodb DYNAMODB_TABLE=<TableName> APP_AWS_REGION=<Region> npm run seed
```

It prints the sign-in details: merchant `demo-merchant@example.com` / `demo-merchant-pass`, customer `+18145550123` / `demo-customer-pass`, and the deal ids. Scripts do not read `.env` files, so pass the variables on the command line.

- The two deals are open from now for 3 and 4 hours. Run the seed within a few hours of the demo; running it again later adds fresh deals and reuses the accounts.
- The demo passwords are in this repo. Anyone who knows them can sign in as the demo merchant; use the demo accounts for the demo only.
- Optional end-to-end check against the deployed app: `bash scripts/curl-flows.sh "$URL"` (49 requests, prints each status). It writes test data into the demo merchant's day (a reservation picked up on a seeded deal, a published and then cancelled "Cinnamon roll" deal, two new customers), which shows up in that day's summary. Run it before seeding for the demo, or skip it and check by hand.
- Or `npm run e2e -- "$URL"`: the full flow with a new test merchant and new customers, every response checked against the contract (the blocked-customer step prints SKIP in production). Its last step cancels the test merchant's remaining deal, so nothing stays in the public list; the test merchant, customers and their history stay in the table. Run it before the demo, not during it.

## 9. Point the mobile app at the API

In the mobile repo, set the API base URL including `/api`, and make sure fixtures are off:

```bash
# mobile/.env
EXPO_PUBLIC_API_URL=https://main.<app-id>.amplifyapp.com/api
# EXPO_PUBLIC_USE_FIXTURES must be unset or not "1"
```

Expo inlines `EXPO_PUBLIC_*` when it bundles, so restart with `npx expo start --clear`. The URL must be public HTTPS (testers use Expo Go on their own phones). Native requests from Expo Go are not subject to CORS; for Expo web, the API answers CORS for the consumer endpoints (`middleware.ts`).

## 10. Check the listing agent on the real model

From your laptop, with credentials allowed to call the model:

```bash
LISTING_MODEL_ID=<model-id> APP_AWS_REGION=<Region> npx tsx scripts/agent-cases.ts
```

It runs the spec's text cases 1 to 9 against the model and exits 0 when all pass (2 = missing model id, region or credentials; nothing is sent then). Then try the photo cases 10 to 12 by hand in the portal (New listing > Add a photo). The spec's bar: products and quantities right in at least 10 of 12, and no allergen or price that the input did not state, in all 12.

## 11. Troubleshooting

Server logs: Amplify console > the app > Hosting > Monitoring > Hosting compute logs (CloudWatch). Build logs: the app > the branch > the build.

| Symptom | Likely cause | Fix |
|---|---|---|
| Build fails in `next/font` ("Failed to fetch `Schibsted Grotesk`" or `TypeError ... reading '1'` in `next/font/google`) | The build downloads the font from Google Fonts; on a cold build that failed in 2 of 5 test builds here. `amplify.yml` and the `Dockerfile` already retry the build once. | If both attempts fail, redeploy. |
| Build fails with `ERROR: DYNAMODB_TABLE is required when STORE_DRIVER=dynamodb (the production default)` (or the PHOTOS_BUCKET / LISTING_MODEL_ID equivalent) | A required variable is missing (step 6). In production an unset driver means the AWS driver. | Add it (or choose the local driver explicitly for a smoke test), redeploy. |
| Every request fails right after a deploy; compute log shows `[config] Configuration error:` and `[config] Stopping` | The server's startup check (`instrumentation.ts`) found a missing or invalid variable and stopped. The message names it. | Fix the variable in the console and redeploy. |
| Build fails with `ERROR: these variables contain '#' or a dollar sign` | `.env.production` cannot carry those characters unchanged. | Change the value (only `LISTING_MODEL_EXTRA_FIELDS` could plausibly need them). |
| Build fails with "Node.js version not supported" or `Node.js 22 is not active` | The build image did not switch to Node 22. | Amplify console > Build settings > Build image settings > Live package updates > Node.js version `22`, then redeploy [12]. |
| Build fails with an out of memory error | Next.js build cache [8]. | Remove `.next/cache/**/*` from `cache.paths` in `amplify.yml` for one build, then put it back [8]. |
| "Build output exceeds the maximum allowed size" or `RequestEntityTooLargeException` | Server bundle too large for Amplify (see step 1). | Download the build artifacts and check `du -csh compute static` [8]. Candidates in this app's trace: `node_modules/@img` (sharp's native binaries, 37 MB) and `node_modules/typescript` (8.8 MB). The docs show deleting files the server does not run after `npm run build` in `amplify.yml` [8]; check the server still starts (`node .next/standalone/server.js` after a local `NEXT_OUTPUT=standalone` build) before relying on it. |
| Every page 404s, or the app is served as static files | Platform is `WEB` instead of `WEB_COMPUTE`. | Step 5.6. |
| `/api/health` works, `/api/deals` returns 500 `INTERNAL` | The server cannot use the table. The log line `[api] unhandled error` names it: `CredentialsProviderError` / "Could not load credentials" = no compute role; `AccessDeniedException` = role or table name wrong; `ResourceNotFoundException` = `DYNAMODB_TABLE` or `APP_AWS_REGION` wrong. | Attach the role (step 5.5); fix the variables and redeploy (variables reach the server only through a build). |
| Log line `[config] STORE_DRIVER=memory in production` (or `[store] ...`); signed-in merchants get signed out, data comes and goes | `STORE_DRIVER=memory` reached the server. Each server instance then has its own memory. | Set `STORE_DRIVER=dynamodb` and redeploy. The build log prints the drivers it saw (`Drivers: store=...`). |
| Merchant sign-in returns 200 but the next page is the sign-in page again | The session cookie is `Secure` in production, so it needs HTTPS; or the memory store (row above). | Use the `https://` Amplify URL (or a custom domain on HTTPS). |
| New listing always falls back to the manual form | The agent returned no drafts. The log line `[listing.extract] {...}` has `outcome` and `error`: `ListingConfigError` = `LISTING_MODEL_ID` missing; `AccessDeniedException` = model access, Marketplace agreement (step 3.3) or `BedrockModelPattern` too narrow; `ValidationException` about the model id = use the inference profile id; about `temperature` or `toolChoice` = unset `LISTING_MODEL_TEMPERATURE` / `LISTING_TOOL_CHOICE`; `timeout` = the model took over 15 s. | Fix the setting, redeploy. Run step 10 from your laptop to see the raw output. |
| Drafts come back with `photo_url: null` | Log line `[listing.drafts] photo upload failed`: `PHOTOS_DRIVER` not `s3`, wrong `PHOTOS_BUCKET`, or no compute role. | Fix, redeploy. |
| Photo URLs return 403 | The bucket policy that makes `photos/*` public was not created (account-level Block Public Access). | Step 2.1, then update the stack. |
| Stack fails at `PhotosBucketPolicy` | Account-level Block Public Access. | Step 2.1. |
| `npm run seed` fails with a credentials error / `AccessDeniedException` / `ResourceNotFoundException` | No laptop credentials / your user cannot write the table / wrong table or region. | `aws login`; use an admin profile; check `DYNAMODB_TABLE` and `APP_AWS_REGION` against the stack outputs. |
| The preflight in step 7 returns no `access-control-allow-origin` | `middleware.ts` did not run on this host. | Only Expo web is affected (Expo Go on phones is not). Use Expo Go for the demo and tell the code owner. |
| The Expo app shows sample data | `EXPO_PUBLIC_API_URL` is unset, or `EXPO_PUBLIC_USE_FIXTURES=1`. | Step 9, restart with `--clear`. |
| The Expo app gets network errors | URL without `/api`, `http://`, or a typo. | `curl "$EXPO_PUBLIC_API_URL/health"` must print `{"ok":true}`. |
| A build fails after a pull request added a dependency from a private npm registry | Amplify's `npm ci` has no access to that registry. | Do not commit `.npmrc`. Ask the PR author for a public package, or set up registry access as an Amplify secret before merging. |

## 12. Fallback: one container

Use this only if Amplify is not an option. The root `Dockerfile` builds the Next.js standalone server (Node 22, non-root user, port 8080). It was not built here (no Docker on the build machine); the same standalone server passed all 49 requests of `scripts/curl-flows.sh` with `NODE_ENV=production`.

Build and try it locally (needs Docker with BuildKit):

```bash
docker build --platform linux/amd64 -t web .
docker run --rm -p 8080:8080 -e STORE_DRIVER=memory -e PHOTOS_DRIVER=local \
  -e LISTING_MODEL_PROVIDER=fake -e SEED_ON_START=1 web
curl -s http://localhost:8080/api/health            # {"ok":true}
```

The image runs with `NODE_ENV=production`, so an unset driver means the AWS one and the server stops at startup when its table, bucket or model id is missing; the local run above picks the local drivers explicitly. On a container service the variables are passed at runtime (there is no `.env.production` step): use the same table as step 6. AWS credentials come from the service's role, never from the image.

Push the image to ECR:

```bash
REGION=us-east-1
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO=$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/web
aws ecr create-repository --region $REGION --repository-name web
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$REGION.amazonaws.com
docker tag web:latest $REPO:latest && docker push $REPO:latest
```

### App Runner (only if your account already uses App Runner)

App Runner is closed to new customers since April 30, 2026 [9]. If the console lets you create a service:

1. Update the stack with the App Runner instance role: rerun step 2 with `--parameter-overrides NamePrefix=app CreateAppRunnerRole=true` (output `AppRunnerInstanceRoleArn`).
2. App Runner console > Create service > Container registry > Amazon ECR > image `$REPO:latest` > ECR access role: create new > Next.
3. Service settings: port `8080`; environment variables from step 6 (plain text); Security > Instance role `<prefix>-apprunner-instance`; Health check > HTTP, path `/api/health`. Create and deploy.
4. The URL is `https://<id>.<region>.awsapprunner.com`. Continue with step 7 (use that URL), 8 and 9.

### ECS Express Mode (AWS's replacement for App Runner)

ECS Express Mode takes a container image and two IAM roles and creates an ECS service on Fargate with a load balancer, scaling and a URL [10][13]. For this app:

- Image `$REPO:latest`, container port `8080`, health check path `/api/health`, environment variables from step 6.
- The two roles Express Mode needs (`ecsTaskExecutionRole`, `ecsInfrastructureRoleForExpressServices`) [10].
- A task role for the app's own AWS calls: IAM > Roles > Create role > AWS service > Elastic Container Service > Elastic Container Service Task > attach the stack's `<prefix>-app-access` policy (output `AppAccessPolicyArn`). The stack does not create this role.
- The mobile app needs HTTPS: check that the service URL is `https://`.

## 13. W8 checklist: billing by hand

W8 is done by hand with the `/monetize` tool (`docs/build-notes.md`, steps 7 to 9). No billing code exists in this repo on purpose (CLAUDE.md). Before you start:

- [ ] W7 is done: the app runs on Amplify and calls DynamoDB, S3 and Bedrock (the tool scans the AWS account and expects the app deployed and calling AWS).
- [ ] Merchants sign in for real (email + password, `lib/auth`). Ask AWS staff whether metering can use this sign-in (build notes, open question 2).
- [ ] The private-registry token stays in your local `.npmrc`, which is gitignored. Never commit it.

Run `/monetize` in the `web` repo (Next.js at the repo root, App Router, Next 15.5). Review its pull request against these hooks, which are where billing plugs in:

| Hook | Where | What it does today |
|---|---|---|
| `plan_status` (`none` / `active`) | `MerchantRecord.plan_status` in `lib/store/types.ts`; changed with `store.updateMerchant(id, { plan_status })`; returned on `Merchant` | Plain field. New merchants start at `none`; the portal shows "Choose a plan" for `none`. |
| `GET /api/billing/links` | `app/api/billing/links/route.ts` calls `billingLinks()` in `lib/services/billing.ts` | Stub: `{ "pricing_url": "", "portal_url": "" }` (empty = no page yet; the portal then hides "Choose a plan"). Needs a merchant session. Return the real URLs here. |
| `recordPickupUsage(reservation)` | `lib/services/billing.ts`; called from `lib/services/reservations.ts` | No-op. Awaited exactly once per reservation that becomes `picked_up` (merchant redeem or customer confirm-pickup; only the winner of a race calls it). One usage event per picked-up reservation goes here. |
| Plan gate | `planGateEnabled()` in `lib/services/billing.ts` (`PLAN_GATE=1`), checked at publish in `lib/services/deals.ts` | Off by default. When on, publish returns 402 `PLAN_REQUIRED` for `plan_status: "none"`. Keep it off tonight so real merchants can list without a test-card checkout, and never turn it on before `billingLinks()` returns a real pricing URL (otherwise the merchant gets PLAN_REQUIRED and no link to a plan). |
| Platform fee in the summary | `PLATFORM_FEE_CENTS_PER_PICKUP = 99` in `lib/services/summary.ts` | Display only. Update it if the final price is not $0.99 per pickup. |

In the pull request, check that:

- [ ] Contract shapes are unchanged (additive only: `docs/api-contract.md`), and `npm run typecheck` and `npm test` pass.
- [ ] No secret, `.env*` or `.npmrc` is committed.
- [ ] Every new server-side environment variable is added to `RUNTIME_VARS` in `amplify.yml` (otherwise the server never sees it) and to `.env.example`. Secret values do not belong in `.env.production` [4]: keep them in a secret store the compute role can read.

After merging (Amplify rebuilds `main`):

- [ ] Publish the pricing plan (proposed: $5 first month with 10 pickups, then $0.99 per pickup; not final).
- [ ] Register for payments (test Stripe Connect account, test cards only) and run one merchant checkout.
- [ ] Send the feedback log and fill in the survey.

## Sources

1. Amplify support for Next.js: https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html
2. Deploying a Next.js SSR application to Amplify: https://docs.aws.amazon.com/amplify/latest/userguide/deploy-nextjs-app.html
3. SSR supported features (Node.js runtimes, CloudWatch logs, size): https://docs.aws.amazon.com/amplify/latest/userguide/ssr-supported-features.html
4. Making environment variables accessible to server-side runtimes: https://docs.aws.amazon.com/amplify/latest/userguide/ssr-environment-variables.html
5. Using environment variables in an Amplify application: https://docs.aws.amazon.com/amplify/latest/userguide/environment-variables.html
6. Adding an SSR Compute role: https://docs.aws.amazon.com/amplify/latest/userguide/amplify-SSR-compute-role.html
7. Amplify API, UpdateApp (`computeRoleArn`, `platform`): https://docs.aws.amazon.com/amplify/latest/APIReference/API_UpdateApp.html
8. Troubleshooting SSR applications (220 MB output, out of memory, 5.72 MB responses, Node.js version): https://docs.aws.amazon.com/amplify/latest/userguide/troubleshooting-SSR.html
9. AWS App Runner availability change: https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html
10. AWS Service Availability Updates (March 2026): https://aws.amazon.com/about-aws/whats-new/2026/03/aws-service-availability/
11. App Runner Node.js runtime releases: https://docs.aws.amazon.com/apprunner/latest/dg/service-source-code-nodejs-releases.html
12. Build image and live package updates: https://docs.aws.amazon.com/amplify/latest/userguide/custom-build-image.html
13. Create your first Express Mode service using the AWS CLI: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-getting-started.html
