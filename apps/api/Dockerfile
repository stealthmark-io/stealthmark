FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json turbo.json ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/telemetry/package.json packages/telemetry/
RUN npm ci

COPY packages/db/tsconfig.json packages/db/
COPY packages/db/src packages/db/src
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/
COPY apps/api/src apps/api/src

# The workspace packages ship TypeScript sources (main points at src/index.ts). Plain node cannot load
# those, so compile them and point the manifests the runtime image installs at the compiled output.
RUN for pkg in db shared; do \
      npx tsc -p packages/$pkg/tsconfig.json \
      && rm -rf packages/$pkg/dist/__tests__ \
      && npm pkg set main=./dist/index.js types=./dist/index.d.ts --workspace=@stealthmark/$pkg; \
    done \
    && npm run build --workspace=@stealthmark/api

FROM node:22-slim
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/
COPY --from=builder /app/packages/db/package.json packages/db/
COPY --from=builder /app/packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --workspace=@stealthmark/api --ignore-scripts \
    && npm cache clean --force
COPY --from=builder /app/packages/db/dist packages/db/dist
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/apps/api/dist apps/api/dist

USER node
WORKDIR /app/apps/api
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "const port = process.env.PORT || 8080; fetch('http://localhost:' + port + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/index.js"]
