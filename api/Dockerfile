# syntax=docker/dockerfile:1
# Multi-stage API image: install deps, then slim runtime with migrate/seed entrypoint.
FROM oven/bun:1 AS install
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    RUN_MIGRATIONS=true \
    RUN_SEED=false

COPY --from=install /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src ./src
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD bun -e "const r = await fetch('http://127.0.0.1:' + (process.env.API_PORT || process.env.PORT || '3000') + '/health'); process.exit(r.ok ? 0 : 1)"

ENTRYPOINT ["./docker-entrypoint.sh"]
