#!/bin/sh
# Dumps the public schema in custom format and streams it to gs://$BACKUP_BUCKET.
# DATABASE_URL comes from Secret Manager (transaction pooler on 6543); pg_dump needs session mode, so 5432 is used.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET is required}"

SESSION_URL=$(printf '%s' "$DATABASE_URL" | sed -E 's#:6543/#:5432/#')
case "$SESSION_URL" in *sslmode=*) ;; *\?*) SESSION_URL="$SESSION_URL&sslmode=require" ;; *) SESSION_URL="$SESSION_URL?sslmode=require" ;; esac

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OBJECT="db/$(date -u +%Y/%m/%d)/stealthmark-public-$STAMP.dump"
DUMP=/tmp/backup.dump

pg_dump --dbname="$SESSION_URL" --schema=public --format=custom --no-owner --no-privileges --file="$DUMP"
SIZE=$(wc -c < "$DUMP")
[ "$SIZE" -gt 1024 ] || { echo "backup too small: $SIZE bytes" >&2; exit 1; }
pg_restore --list "$DUMP" > /dev/null

TOKEN=$(curl -sS --fail -H 'Metadata-Flavor: Google' \
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token' \
  | sed -E 's/.*"access_token":"([^"]+)".*/\1/')
ENCODED=$(printf '%s' "$OBJECT" | sed 's#/#%2F#g')
curl -sS --fail -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/octet-stream' \
  --data-binary @"$DUMP" \
  "https://storage.googleapis.com/upload/storage/v1/b/$BACKUP_BUCKET/o?uploadType=media&name=$ENCODED" > /dev/null
rm -f "$DUMP"
echo "backup ok: gs://$BACKUP_BUCKET/$OBJECT ($SIZE bytes)"
