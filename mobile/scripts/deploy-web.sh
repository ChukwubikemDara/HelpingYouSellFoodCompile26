#!/usr/bin/env bash
# Builds the consumer app for the web and publishes it with Amplify Hosting
# (manual deployment, no Git connection). Safe to re-run: it reuses the app and
# branch when they exist and only uploads a new build.
#
# Usage: scripts/deploy-web.sh
# Env (all optional):
#   EXPO_PUBLIC_API_URL  API base URL baked into the bundle (default: the live API)
#   OUT_DIR              where `expo export` writes the build (default: a fresh temp dir)
#   AMPLIFY_APP_NAME     Amplify app name (default: c0mpiled-consumer-web)
#   AMPLIFY_BRANCH       Amplify branch (default: main)
#   AWS_REGION           default: us-east-2
# Needs: node/npx, aws CLI (signed in), curl, python3.

set -euo pipefail

API_URL="${EXPO_PUBLIC_API_URL:-https://main.d19grvvand435u.amplifyapp.com/api}"
APP_NAME="${AMPLIFY_APP_NAME:-c0mpiled-consumer-web}"
BRANCH="${AMPLIFY_BRANCH:-main}"
REGION="${AWS_REGION:-us-east-2}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
OUT_DIR="${OUT_DIR:-$WORK/dist}"
trap 'rm -rf "$WORK"' EXIT

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'deploy-web: %s\n' "$*" >&2; exit 1; }
aws_() { aws --region "$REGION" "$@"; }

for cmd in npx aws curl python3; do
  command -v "$cmd" >/dev/null || die "$cmd not found on PATH"
done

# 1. Build ------------------------------------------------------------------
log "Building web export (API: $API_URL) into $OUT_DIR"
rm -rf "$OUT_DIR"
mkdir -p "$WORK/tmp"
(
  cd "$ROOT"
  # Explicit env wins over .env, so the bundle always points at API_URL.
  # EXPO_PUBLIC_* values are inlined at transform time, and Metro's transform cache
  # (os.tmpdir()/metro-cache) does not key on them: a cached transform from another
  # build can carry a different URL. A private TMPDIR gives this build its own cache
  # without clearing the one a running dev server uses.
  TMPDIR="$WORK/tmp" EXPO_PUBLIC_API_URL="$API_URL" EXPO_PUBLIC_USE_FIXTURES=0 \
    npx expo export --platform web --output-dir "$OUT_DIR"
)
[ -f "$OUT_DIR/index.html" ] || die "export produced no index.html"
grep -rqF "$API_URL" "$OUT_DIR/_expo" || die "bundle does not contain $API_URL"

ZIP="$WORK/site.zip"
python3 -I - "$OUT_DIR" "$ZIP" <<'PY'
import os, sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
    for base, _, files in os.walk(src):
        for name in files:
            full = os.path.join(base, name)
            z.write(full, os.path.relpath(full, src))
PY

# 2. App and branch -----------------------------------------------------------
log "Finding Amplify app '$APP_NAME' in $REGION"
APP_ID="$(aws_ amplify list-apps --max-results 100 \
  --query "apps[?name=='$APP_NAME'].appId | [0]" --output text)"
if [ -z "$APP_ID" ] || [ "$APP_ID" = "None" ]; then
  log "Creating Amplify app '$APP_NAME'"
  APP_ID="$(aws_ amplify create-app --name "$APP_NAME" --platform WEB \
    --query app.appId --output text)"
fi
[ -n "$APP_ID" ] && [ "$APP_ID" != "None" ] || die "could not find or create the app"
echo "app id: $APP_ID"

# Single-page app: any path that is not a static file serves index.html (200),
# so deep links such as /deal/<id> load the app.
RULES='[{"source":"</^[^.]+$|\\.(?!(css|gif|ico|jpg|jpeg|js|json|map|png|svg|txt|ttf|otf|woff|woff2|webp|webmanifest|html|xml|mp4|wasm)$)([^.]+$)/>","target":"/index.html","status":"200"}]'
aws_ amplify update-app --app-id "$APP_ID" --custom-rules "$RULES" \
  --query app.appId --output text >/dev/null

if ! aws_ amplify get-branch --app-id "$APP_ID" --branch-name "$BRANCH" >/dev/null 2>&1; then
  log "Creating branch '$BRANCH'"
  aws_ amplify create-branch --app-id "$APP_ID" --branch-name "$BRANCH" \
    --query branch.branchName --output text >/dev/null
fi

# 3. Upload and deploy --------------------------------------------------------
# A previous run that died mid-way can leave a pending job; it blocks new ones.
PENDING="$(aws_ amplify list-jobs --app-id "$APP_ID" --branch-name "$BRANCH" --max-results 5 \
  --query "jobSummaries[?status=='PENDING'].jobId" --output text)"
for J in $PENDING; do
  [ "$J" = "None" ] && continue
  echo "stopping stale pending job $J"
  aws_ amplify stop-job --app-id "$APP_ID" --branch-name "$BRANCH" --job-id "$J" >/dev/null || true
done

log "Creating deployment"
read -r JOB_ID UPLOAD_URL < <(aws_ amplify create-deployment --app-id "$APP_ID" --branch-name "$BRANCH" \
  --query '[jobId, zipUploadUrl]' --output text)
[ -n "${JOB_ID:-}" ] && [ -n "${UPLOAD_URL:-}" ] || die "create-deployment returned no job or upload URL"
echo "job id: $JOB_ID"

log "Uploading $(du -h "$ZIP" | cut -f1) zip"
curl --fail --silent --show-error -T "$ZIP" "$UPLOAD_URL"

aws_ amplify start-deployment --app-id "$APP_ID" --branch-name "$BRANCH" --job-id "$JOB_ID" \
  --query job.summary.status --output text >/dev/null

log "Waiting for job $JOB_ID"
STATUS=""
for _ in $(seq 1 90); do
  STATUS="$(aws_ amplify get-job --app-id "$APP_ID" --branch-name "$BRANCH" --job-id "$JOB_ID" \
    --query job.summary.status --output text)"
  case "$STATUS" in
    SUCCEED) break ;;
    FAILED | CANCELLED) die "job $JOB_ID ended $STATUS" ;;
  esac
  sleep 5
done
[ "$STATUS" = "SUCCEED" ] || die "job $JOB_ID still $STATUS after 7.5 minutes"

DOMAIN="$(aws_ amplify get-app --app-id "$APP_ID" --query app.defaultDomain --output text)"
URL="https://$BRANCH.$DOMAIN"

# 4. Smoke check ---------------------------------------------------------------
log "Checking $URL"
fetch() { curl --fail --silent --show-error --retry 5 --retry-delay 3 --retry-all-errors "$@"; }
fetch "$URL/" -o "$WORK/index.html"
grep -q '<div id="root">' "$WORK/index.html" || die "$URL/ did not return the app HTML"
BUNDLE="$(grep -o '/_expo/static/js/web/[^"]*\.js' "$WORK/index.html" | head -n 1)"
[ -n "$BUNDLE" ] || die "no bundle script in the served HTML"
fetch "$URL$BUNDLE" -o "$WORK/bundle.js"
grep -qF "$API_URL" "$WORK/bundle.js" || die "served bundle does not contain $API_URL"
fetch "$URL/deal/smoke-check" -o "$WORK/deep.html"
grep -q '<div id="root">' "$WORK/deep.html" || die "deep link did not return the app HTML (rewrite rule)"

log "Live: $URL"
echo "$URL"
