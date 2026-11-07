#!/usr/bin/env bash
set -euo pipefail

# ═════════════════════════════════════════════════════════════════════
# StealthMark Agent Gateway — Google Cloud Run Deploy Script
# ═════════════════════════════════════════════════════════════════════

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/google-cloud-sdk/bin:$PATH"

PROJECT_ID="${GCP_PROJECT:-stealthmark-prod}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="stealthmark-gateway"
UPSTREAM_URL="${UPSTREAM_URL:-https://www.democv.example.com}"

echo "============================================================"
echo "🚀 Desplegando StealthMark Gateway en Google Cloud Run"
echo "• Proyecto:    ${PROJECT_ID}"
echo "• Región:      ${REGION}"
echo "• Servicio:    ${SERVICE_NAME}"
echo "• Upstream:    ${UPSTREAM_URL}"
echo "============================================================"

# Change to the script's directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

# Ensure active project is set
gcloud config set project "${PROJECT_ID}" --quiet

# Deploy to Cloud Run using source build
gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --concurrency 80 \
  --timeout 60s \
  --min-instances 0 \
  --max-instances 10 \
  --set-env-vars UPSTREAM_DEMOCV="https://www.democv.example.com",SUPABASE_URL="https://wnaovainovzaspjzcgox.supabase.co" \
  --set-secrets SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,INTERNAL_AUTH_SECRET=INTERNAL_AUTH_SECRET:latest

# Retrieve deployed public URL
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --format='value(status.url)')

echo ""
echo "============================================================"
echo "✅ Despliegue Exitoso en Cloud Run!"
echo "🌐 URL Pública: ${SERVICE_URL}"
echo "============================================================"
echo ""
echo "Para verificar los 4 escenarios de prueba inmediatamente:"
echo "  ./test_prod.sh ${SERVICE_URL}"
