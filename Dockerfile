# Multi-stage build for the LPI ERP Next.js app (SQLite + optional MongoDB backup).
# Runs `next start` against a full production install (not the standalone output) so
# native modules (better-sqlite3) and the mongodb driver behave exactly like `yarn build`.

FROM node:22-bookworm-slim AS builder
WORKDIR /app

# better-sqlite3 compiles a native addon at install time.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN corepack enable && yarn install

COPY . .
RUN yarn build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends dumb-init \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --uid 1001 erp

COPY --from=builder --chown=erp:erp /app ./

# DB, uploads and GridFS-restore tmp files live under /app/data (mount a volume here).
RUN mkdir -p /app/data && chown -R erp:erp /app/data

USER erp
EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
