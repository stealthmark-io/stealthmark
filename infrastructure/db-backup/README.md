# Daily database backup (Google Cloud)

Supabase Free has no backups or point-in-time recovery. This job keeps a daily logical copy of the `public` schema in Cloud Storage.

| Piece | Value |
|---|---|
| Schedule | Cloud Scheduler `stealthmark-db-backup-daily`, every day 06:00 UTC |
| Runner | Cloud Run Job `stealthmark-db-backup` (pg_dump 17, custom format) |
| Storage | `gs://stealthmark-prod-db-backups/db/YYYY/MM/DD/`, deleted after 30 days, no public access |
| Identity | `db-backup@stealthmark-prod` with only object create on the bucket and read on `STEALTHMARK_DATABASE_URL` |

Recovery point: up to 24 hours. Supabase-managed schemas (`auth`, `storage`) are not included.

Run once by hand: `gcloud run jobs execute stealthmark-db-backup --region=us-central1 --project=stealthmark-prod --wait`

Restore into an empty database:

```bash
gcloud storage cp gs://stealthmark-prod-db-backups/db/<date>/<file>.dump .
pg_restore --dbname="<session-mode connection string, port 5432>" --no-owner --no-privileges --clean --if-exists <file>.dump
```
