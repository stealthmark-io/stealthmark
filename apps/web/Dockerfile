FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json turbo.json ./
COPY apps/web/package.json apps/web/
COPY packages/a2a-client/package.json packages/a2a-client/
COPY packages/db/package.json packages/db/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/shared/package.json packages/shared/
COPY packages/telemetry/package.json packages/telemetry/
RUN npm ci || npm install --legacy-peer-deps
COPY . .
RUN npx turbo run build --filter=@stealthmark/web

FROM node:22-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/web/package.json ./apps/web/
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public
WORKDIR /app/apps/web
ENV PATH="/app/node_modules/.bin:${PATH}"
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:${PORT} || exit 1
CMD ["sh", "-c", "next start -p ${PORT:-8080}"]

