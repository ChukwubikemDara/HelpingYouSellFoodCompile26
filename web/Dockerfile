# syntax=docker/dockerfile:1
#
# Fallback hosting: the web app as one container running the Next.js
# standalone server (AWS App Runner, or ECS Express Mode where App Runner is
# closed to the account). Primary hosting is Amplify (amplify.yml).
# Steps: docs/DEPLOY.md, "Fallback: one container".
#
#   docker build -t web .
#   docker run --rm -p 8080:8080 -e STORE_DRIVER=memory -e PHOTOS_DRIVER=local \
#     -e LISTING_MODEL_PROVIDER=fake -e SEED_ON_START=1 web    # local drivers, demo data
#   curl http://localhost:8080/api/health                        # {"ok":true}
#
# NODE_ENV=production in the image: an unset driver means the AWS one, and the
# server stops at startup if its DYNAMODB_TABLE / PHOTOS_BUCKET /
# LISTING_MODEL_ID is missing (lib/config.ts).
#
# Runtime configuration is plain environment variables (.env.example lists
# them); nothing is baked into the image. AWS credentials come from the
# service's instance or task role, never from the image. .dockerignore keeps
# .env*, .npmrc, *.pem, .git and docs/ out of the build context.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
# NEXT_OUTPUT=standalone makes next.config.ts emit .next/standalone (server.js + traced node_modules).
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# One retry: next/font's download from Google Fonts failed now and then on a cold build.
RUN mkdir -p public && (npm run build || (echo "Build failed; retrying once." && npm run build))

FROM node:${NODE_VERSION}-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Writable only for PHOTOS_DRIVER=local (local runs). Use PHOTOS_DRIVER=s3 on AWS: container disks are not kept.
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server.js"]
