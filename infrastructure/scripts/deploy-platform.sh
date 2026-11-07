#!/usr/bin/env bash
set -euo pipefail

# ═════════════════════════════════════════════════════════════════════
# StealthMark API Deployment — Google Cloud Run
# The web app is deployed by Vercel and the gateway by infrastructure/gateway-lab/deploy.sh.
# ═════════════════════════════════════════════════════════════════════

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/google-cloud-sdk/bin:$PATH"

PROJECT_ID="${GCP_PROJECT:-stealthmark-prod}"
REGION="${GCP_REGION:-us-central1}"

echo "============================================================"
echo "🚀 DESPLEGANDO STEALTHMARK API EN GOOGLE CLOUD RUN"
echo "• Proyecto: ${PROJECT_ID}"
echo "• Región:   ${REGION}"
echo "============================================================"
echo ""

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

# Set active project
gcloud config set project "${PROJECT_ID}" --quiet

# ─────────────────────────────────────────────────────────────
# 1. Despliegue de Backend Core API (@stealthmark/api)
# ─────────────────────────────────────────────────────────────
echo "▶ [1/1] Compilando y Desplegando StealthMark API Core (Fastify Node 22)..."
API_IMAGE="us-central1-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/stealthmark-api:latest"

gcloud builds submit \
  --project "${PROJECT_ID}" \
  --config infrastructure/cloudbuild-api.yaml .

gcloud run deploy stealthmark-api \
  --image "${API_IMAGE}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --concurrency 80 \
  --timeout 60s \
  --min-instances 1 \
  --max-instances 5 \
  --update-env-vars NODE_ENV="production",LOG_LEVEL="info" \
  --update-secrets DATABASE_URL=STEALTHMARK_DATABASE_URL:latest,INTERNAL_AUTH_SECRET=INTERNAL_AUTH_SECRET:latest,PASSPORT_PRIVATE_KEY=PASSPORT_PRIVATE_KEY:latest,PASSPORT_PUBLIC_KEY=PASSPORT_PUBLIC_KEY:latest

API_URL=$(gcloud run services describe stealthmark-api \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --format='value(status.url)')

echo "✅ StealthMark API desplegada en: ${API_URL}"
echo ""

echo "============================================================"
echo "🎉 DESPLIEGUE COMPLETO DE STEALTHMARK API"
echo "• API Core:  ${API_URL}"
echo "• Gateway:   https://gateway.stealthmark.io"
echo "============================================================"
