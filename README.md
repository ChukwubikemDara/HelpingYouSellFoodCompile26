# Last Call

Local bakeries, cafes and restaurants in State College post a limited quantity of items at a discount for a pickup window. Students reserve in the app, get a 4-digit pickup code and pay in store. Built at c0mpiled-15 (Penn State).

| Folder | What it is |
|---|---|
| [`web/`](web) | Next.js 15 app on AWS Amplify: the JSON API under `/api` and the merchant portal. DynamoDB, S3, Amazon Bedrock (Claude) for the listing assistant. |
| [`mobile/`](mobile) | Expo (React Native) consumer app: deals list and map, reserve, pickup ticket, alerts, store mode. Also exported as a web app. |

## Live

- Consumer app (web): https://main.d2glcfdrf9zd7f.amplifyapp.com
- Merchant portal: https://main.d19grvvand435u.amplifyapp.com/signin
- API health: https://main.d19grvvand435u.amplifyapp.com/api/health

## The listing assistant

A merchant types "6 croissants, 3 baguettes, closing at 6" or snaps a photo. One Claude call on Bedrock extracts what was stated (schema-constrained), then plain code builds the drafts: menu prices, default discount, pickup window, missing fields. It never invents a price, never sets allergens, never publishes; the merchant approves. Spec: `web/docs/agent-spec.md`; A/B harness: `web/scripts/eval/listing-ab.ts`.

## Docs

- API contract: `web/docs/api-contract.md`
- Architecture: `web/docs/ARCHITECTURE.md`
- AWS resources: `web/docs/AWS.md`; deploy steps: `web/docs/DEPLOY.md`
- Mobile setup: `mobile/README.md`

Demo data (restaurants, cafes, bakeries) comes from public listings; allergens on demo deals are placeholders and must be confirmed by each store.
