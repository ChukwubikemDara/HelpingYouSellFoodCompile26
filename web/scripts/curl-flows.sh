#!/usr/bin/env bash
# End-to-end API check with curl against a running server seeded with the
# demo data (SEED_ON_START=1 with the memory driver, or `npm run seed`).
#
#   scripts/curl-flows.sh [base_url]      default http://localhost:3101
#
# Prints every request with its status and exits non-zero on the first
# unexpected status. Needs curl and node (for reading JSON). Safe to re-run
# against the same server: it signs up a fresh customer each run.
set -euo pipefail

BASE="${1:-http://localhost:3101}"
BASE="${BASE%/}"
API="$BASE/api"

SEED_MERCHANT_EMAIL="demo-merchant@example.com"
SEED_MERCHANT_PASSWORD="demo-merchant-pass"
SEED_CUSTOMER_PHONE="+18145550123"
SEED_CUSTOMER_PASSWORD="demo-customer-pass"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
JAR="$WORK/cookies.txt"
BODY="$WORK/body.json"
STEP=0

# json <expression>: read a value from the last response body, e.g. json '.deals[0].id'
json() {
  node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const value = new Function("d", "return d" + process.argv[2])(data);
    if (value === undefined || value === null) process.exit(3);
    process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
  ' "$BODY" "$1"
}

# iso <minutes from now>: ISO 8601 UTC timestamp (GNU or BSD date).
iso() {
  local minutes="$1"
  date -u -d "@$(( $(date +%s) + minutes * 60 ))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || date -u -r "$(( $(date +%s) + minutes * 60 ))" +%Y-%m-%dT%H:%M:%SZ
}

# req <expected status> <label> <method> <path> [json body] [auth: jar|bearer:<token>|none]
req() {
  local expected="$1" label="$2" method="$3" path="$4" body="${5:-}" auth="${6:-none}"
  local args=(-s -o "$BODY" -w '%{http_code}' -X "$method" "$API$path")
  if [[ -n "$body" ]]; then args+=(-H 'content-type: application/json' --data "$body"); fi
  case "$auth" in
    jar) args+=(-b "$JAR" -c "$JAR") ;;
    bearer:*) args+=(-H "authorization: Bearer ${auth#bearer:}") ;;
  esac
  STEP=$((STEP + 1))
  local status
  status="$(curl "${args[@]}" || echo 000)"
  if [[ "$status" == "$expected" ]]; then
    printf '%3d  ok    %s  %-6s %-48s %s\n' "$STEP" "$status" "$method" "$path" "$label"
  else
    printf '%3d  FAIL  %s  %-6s %-48s %s (expected %s)\n' "$STEP" "$status" "$method" "$path" "$label" "$expected"
    echo "      body: $(head -c 500 "$BODY" 2>/dev/null)"
    exit 1
  fi
}

echo "API: $API"
req 200 "health" GET /health

echo
echo "== Consumer flow =="
req 200 "seeded customer signs in" POST /auth/customer/signin \
  "{\"phone\":\"$SEED_CUSTOMER_PHONE\",\"password\":\"$SEED_CUSTOMER_PASSWORD\"}"
PHONE="+1814$(printf '%07d' $(( ($(date +%s) * 7 + RANDOM) % 10000000 )))"
req 201 "new customer signs up" POST /auth/customer/signup \
  "{\"name\":\"Alex\",\"phone\":\"$PHONE\",\"password\":\"password123\"}"
req 200 "new customer signs in" POST /auth/customer/signin "{\"phone\":\"$PHONE\",\"password\":\"password123\"}"
TOKEN="$(json .token)"
req 200 "customers/me" GET /customers/me "" "bearer:$TOKEN"
req 401 "customers/me without a token" GET /customers/me

req 200 "list deals (ending soon)" GET /deals
DEAL_ID="$(json '.deals.find((x) => x.status === "live" && x.quantity_left > 0).id')"
MERCHANT_ID="$(json '.deals.find((x) => x.status === "live" && x.quantity_left > 0).merchant_id')"
req 200 "list deals sorted by distance" GET "/deals?sort=distance&lat=40.7962&lng=-77.8627"
json '.deals[0].distance_m' >/dev/null || { echo "      distance_m missing"; exit 1; }
req 422 "sort=distance without lat/lng" GET "/deals?sort=distance"
req 200 "deal detail" GET "/deals/$DEAL_ID"
req 200 "follow the store" POST /follows "{\"merchant_id\":\"$MERCHANT_ID\"}" "bearer:$TOKEN"
req 200 "list follows" GET /follows "" "bearer:$TOKEN"

req 201 "reserve 1" POST /reservations "{\"deal_id\":\"$DEAL_ID\",\"quantity\":1}" "bearer:$TOKEN"
RES_ID="$(json .id)"
req 200 "get reservation" GET "/reservations/$RES_ID" "" "bearer:$TOKEN"
req 200 "list my reservations" GET /reservations "" "bearer:$TOKEN"
req 200 "cancel reservation" POST "/reservations/$RES_ID/cancel" "" "bearer:$TOKEN"
req 422 "cancel it again" POST "/reservations/$RES_ID/cancel" "" "bearer:$TOKEN"
req 201 "reserve again" POST /reservations "{\"deal_id\":\"$DEAL_ID\",\"quantity\":1}" "bearer:$TOKEN"
RES_ID="$(json .id)"
req 200 "confirm pickup" POST "/reservations/$RES_ID/confirm-pickup" "" "bearer:$TOKEN"
req 409 "confirm pickup again" POST "/reservations/$RES_ID/confirm-pickup" "" "bearer:$TOKEN"

OTHER_PHONE="+1814$(printf '%07d' $(( ($(date +%s) * 13 + RANDOM) % 10000000 )))"
req 201 "another customer signs up" POST /auth/customer/signup \
  "{\"name\":\"Riley\",\"phone\":\"$OTHER_PHONE\",\"password\":\"password123\"}"
OTHER_TOKEN="$(json .token)"
req 404 "another customer cannot see it" GET "/reservations/$RES_ID" "" "bearer:$OTHER_TOKEN"
req 404 "another customer cannot cancel it" POST "/reservations/$RES_ID/cancel" "" "bearer:$OTHER_TOKEN"
req 200 "notifications" GET /notifications "" "bearer:$TOKEN"
req 200 "notifications since" GET "/notifications?since=$(iso -60)" "" "bearer:$TOKEN"

echo
echo "== Merchant flow =="
req 401 "me without a session" GET /me
req 200 "merchant signs in (cookie jar)" POST /auth/merchant/signin \
  "{\"email\":\"$SEED_MERCHANT_EMAIL\",\"password\":\"$SEED_MERCHANT_PASSWORD\"}" jar
req 200 "me" GET /me "" jar
MID="$(json .merchant.id)"
req 200 "patch merchant" PATCH "/merchants/$MID" '{"default_discount_pct":50}' jar
req 404 "another merchant id is 404" GET "/merchants/m_not_mine" "" jar

START="$(iso 0)"
END="$(iso 120)"
req 200 "create manual deal (draft)" POST /deals \
  "{\"title\":\"Cinnamon roll\",\"items\":[{\"name\":\"Cinnamon roll\",\"qty\":1}],\"original_price_cents\":425,\"deal_price_cents\":200,\"quantity_total\":3,\"pickup_start\":\"$START\",\"pickup_end\":\"$END\"}" jar
NEW_DEAL="$(json .id)"
req 422 "publish without allergens" POST "/deals/$NEW_DEAL/publish" "" jar
req 200 "patch draft note" PATCH "/deals/$NEW_DEAL" '{"note":"Fresh from the oven."}' jar
req 200 "set allergens" PATCH "/deals/$NEW_DEAL" '{"allergens":["wheat","milk"]}' jar
req 200 "publish" POST "/deals/$NEW_DEAL/publish" "" jar
req 200 "today's deals" GET "/merchants/$MID/deals" "" jar
req 201 "customer reserves the new deal" POST /reservations "{\"deal_id\":\"$NEW_DEAL\",\"quantity\":1}" "bearer:$TOKEN"
CODE="$(json .pickup_code)"
req 200 "today's reservations" GET "/merchants/$MID/reservations" "" jar
req 200 "redeem pickup code" POST /reservations/redeem "{\"pickup_code\":\"$CODE\"}" jar
req 409 "redeem again -> CODE_ALREADY_USED" POST /reservations/redeem "{\"pickup_code\":\"$CODE\"}" jar
[[ "$(json .error.code)" == "CODE_ALREADY_USED" ]] || { echo "      wrong error code"; exit 1; }
req 200 "lower the price" PATCH "/deals/$NEW_DEAL" '{"deal_price_cents":150}' jar
req 422 "raise the price" PATCH "/deals/$NEW_DEAL" '{"deal_price_cents":175}' jar
req 200 "summary" GET "/merchants/$MID/summary" "" jar
req 200 "suggestions" GET "/merchants/$MID/suggestions" "" jar
req 200 "billing links" GET /billing/links "" jar
req 200 "cancel the deal" POST "/deals/$NEW_DEAL/cancel" "" jar
req 409 "cancel it again" POST "/deals/$NEW_DEAL/cancel" "" jar
req 200 "sign out" POST /auth/merchant/signout "" jar
req 401 "me after sign out" GET /me "" jar

echo
echo "All $STEP requests returned the expected status."
