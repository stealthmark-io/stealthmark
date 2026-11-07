#!/usr/bin/env bash
set -euo pipefail

# Legacy Cloud Run deploy of the web app. Production stealthmark.io is served from Vercel and no
# stealthmark-web Cloud Run service exists. Never set a sandbox or demo auth flag here.

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/google-cloud-sdk/bin:$PATH"

PROJECT_ID="${GCP_PROJECT:-stealthmark-prod}"
REGION="${GCP_REGION:-us-central1}"

echo "============================================================"
echo "🚀 DESPLEGANDO STEALTHMARK WEB UI EN GOOGLE CLOUD RUN"
echo "• Proyecto: ${PROJECT_ID}"
echo "• Región:   ${REGION}"
echo "============================================================"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

gcloud config set project "${PROJECT_ID}" --quiet

echo "▶ Compilando y Desplegando StealthMark Web UI (Next.js 15)..."
WEB_IMAGE="us-central1-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/stealthmark-web:latest"

gcloud builds submit \
  --project "${PROJECT_ID}" \
  --config infrastructure/cloudbuild-web.yaml .

gcloud run deploy stealthmark-web \
  --image "${WEB_IMAGE}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --concurrency 80 \
  --timeout 60s \
  --min-instances 0 \
  --set-env-vars NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL}",INTERNAL_API_URL="${INTERNAL_API_URL}",NEXT_PUBLIC_GATEWAY_URL="${NEXT_PUBLIC_GATEWAY_URL}",NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-https://stealthmark.io}",AUTH_SECRET="${AUTH_SECRET}",INTERNAL_AUTH_SECRET="${INTERNAL_AUTH_SECRET}",NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL}",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}",NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
  --set-secrets RESEND_API_KEY=RESEND_API_KEY:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,SUPABASE_JWT_SECRET=SUPABASE_JWT_SECRET:latest

WEB_URL=$(gcloud run services describe stealthmark-web \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --format='value(status.url)')

echo "============================================================"
echo "✅ StealthMark Web UI desplegada exitosamente:"
echo "• Web UI: ${WEB_URL}"
echo "============================================================"
