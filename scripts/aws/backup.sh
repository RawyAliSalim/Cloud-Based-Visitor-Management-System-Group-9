#!/usr/bin/env bash
# Dumps the local MongoDB database (Docker) and uploads it to the S3 backup bucket.
# Usage: bash scripts/aws/backup.sh            (database name defaults to "vms")
source "$(dirname "$0")/common.sh"
require_floci

DB="${1:-vms}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$WORK_DIR/$DB-$STAMP.archive.gz"
KEY="mongo/$DB/$DB-$STAMP.archive.gz"

echo "== Dumping MongoDB database '$DB'"
docker compose exec -T mongo mongodump --db "$DB" --archive --gzip --quiet > "$FILE"
SIZE=$(wc -c < "$FILE" | tr -d ' ')
if [[ "$SIZE" -lt 100 ]]; then
  echo "Dump looks empty ($SIZE bytes). Is the mongo container running?" >&2
  exit 1
fi
SHA=$(node -e "const c=require('crypto').createHash('sha256');c.update(require('fs').readFileSync(process.argv[1]));console.log(c.digest('hex'))" "$FILE")

echo "== Uploading to s3://$BUCKET/$KEY ($SIZE bytes)"
aws s3 cp "$FILE" "s3://$BUCKET/$KEY" --sse AES256 --metadata "sha256=$SHA,database=$DB" --only-show-errors
rm -f "$FILE"

echo "Backup stored. Recent backups:"
aws s3 ls "s3://$BUCKET/mongo/$DB/" | tail -5
