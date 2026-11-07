#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════
# StealthMark Platform — GCP Setup Script
# ═══════════════════════════════════════════

PROJECT_ID="${GCP_PROJECT_ID:-stealthmark-platform}"
REGION="${GCP_REGION:-us-central1}"
DB_INSTANCE="stealthmark-db"
DB_NAME="stealthmark"
DB_USER="stealthmark_app"

echo "Creating GCP project: ${PROJECT_ID}..."
gcloud projects create "${PROJECT_ID}" --name="StealthMark Platform" || true
gcloud config set project "${PROJECT_ID}"

echo "Enabling required APIs..."
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  sql-component.googleapis.com \
  identitytoolkit.googleapis.com \
  cloudtasks.googleapis.com \
  pubsub.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  monitoring.googleapis.com \
  logging.googleapis.com \
  storage.googleapis.com

echo "Creating Artifact Registry..."
gcloud artifacts repositories create stealthmark \
  --repository-format=docker \
  --location="${REGION}" || true

echo "Creating API Service Account..."
gcloud iam service-accounts create stealthmark-api \
  --display-name="StealthMark API Service" || true

SA_EMAIL="stealthmark-api@${PROJECT_ID}.iam.gserviceaccount.com"

echo "Granting IAM roles to ${SA_EMAIL}..."
for role in roles/cloudsql.client roles/secretmanager.secretAccessor roles/cloudtasks.enqueuer roles/pubsub.publisher; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${role}" --quiet
done

echo "GCP Setup completed successfully!"
