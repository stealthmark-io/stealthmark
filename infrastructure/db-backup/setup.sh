#!/usr/bin/env bash
# Idempotent setup of the daily database backup: bucket, service account, Cloud Run Job and Cloud Scheduler trigger.
set -euo pipefail
P=stealthmark-prod
R=us-central1
BUCKET=stealthmark-prod-db-backups
SA=db-backup@$P.iam.gserviceaccount.com
IMAGE=us-central1-docker.pkg.dev/$P/cloud-run-source-deploy/stealthmark-db-backup:latest
cd "$(dirname "$0")"

gcloud services enable cloudscheduler.googleapis.com --project=$P --quiet
gcloud storage buckets describe gs://$BUCKET --project=$P >/dev/null 2>&1 || \
  gcloud storage buckets create gs://$BUCKET --project=$P --location=$R --uniform-bucket-level-access --public-access-prevention
printf '{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}' > /tmp/db-backup-lifecycle.json
gcloud storage buckets update gs://$BUCKET --lifecycle-file=/tmp/db-backup-lifecycle.json
gcloud iam service-accounts describe $SA --project=$P >/dev/null 2>&1 || \
  gcloud iam service-accounts create db-backup --project=$P --display-name="StealthMark DB backup"
gcloud storage buckets add-iam-policy-binding gs://$BUCKET --member=serviceAccount:$SA --role=roles/storage.objectCreator >/dev/null
gcloud secrets add-iam-policy-binding STEALTHMARK_DATABASE_URL --project=$P --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor >/dev/null

gcloud builds submit --project=$P --tag $IMAGE .
gcloud run jobs deploy stealthmark-db-backup --project=$P --region=$R --image=$IMAGE \
  --service-account=$SA --set-secrets=DATABASE_URL=STEALTHMARK_DATABASE_URL:latest \
  --set-env-vars=BACKUP_BUCKET=$BUCKET --max-retries=1 --task-timeout=600s --memory=512Mi --cpu=1
gcloud run jobs add-iam-policy-binding stealthmark-db-backup --project=$P --region=$R --member=serviceAccount:$SA --role=roles/run.invoker >/dev/null

JOB_URI="https://run.googleapis.com/v2/projects/$P/locations/$R/jobs/stealthmark-db-backup:run"
if gcloud scheduler jobs describe stealthmark-db-backup-daily --project=$P --location=$R >/dev/null 2>&1; then
  gcloud scheduler jobs update http stealthmark-db-backup-daily --project=$P --location=$R --schedule="0 6 * * *" --time-zone=UTC \
    --uri="$JOB_URI" --http-method=POST --oauth-service-account-email=$SA
else
  gcloud scheduler jobs create http stealthmark-db-backup-daily --project=$P --location=$R --schedule="0 6 * * *" --time-zone=UTC \
    --uri="$JOB_URI" --http-method=POST --oauth-service-account-email=$SA
fi
echo "setup ok"
