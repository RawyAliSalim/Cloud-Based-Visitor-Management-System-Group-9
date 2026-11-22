#!/usr/bin/env bash
# Restores a backup from S3 into the local MongoDB container. This REPLACES the local data.
# Usage: bash scripts/aws/restore.sh --yes [s3-key]   (default: newest backup of "vms")
source "$(dirname "$0")/common.sh"
require_floci

if [[ "${1:-}" != "--yes" ]]; then
  echo "This replaces the local '${VMS_DB:-vms}' database with a backup. Run again with --yes to continue." >&2
  exit 1
fi
DB="${VMS_DB:-vms}"
KEY="${2:-$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "mongo/$DB/" --query 'sort_by(Contents,&LastModified)[-1].Key' --output text)}"
if [[ -z "$KEY" || "$KEY" == "None" ]]; then
  echo "No backups found in s3://$BUCKET/mongo/$DB/" >&2
  exit 1
fi

FILE="$WORK_DIR/restore.archive.gz"
echo "== Downloading s3://$BUCKET/$KEY"
aws s3 cp "s3://$BUCKET/$KEY" "$FILE" --only-show-errors

EXPECTED=$(aws s3api head-object --bucket "$BUCKET" --key "$KEY" --query 'Metadata.sha256' --output text)
ACTUAL=$(node -e "const c=require('crypto').createHash('sha256');c.update(require('fs').readFileSync(process.argv[1]));console.log(c.digest('hex'))" "$FILE")
if [[ "$EXPECTED" != "None" && "$EXPECTED" != "$ACTUAL" ]]; then
  echo "Checksum mismatch: the backup is damaged. Nothing was restored." >&2
  rm -f "$FILE"
  exit 1
fi
echo "   checksum verified"

echo "== Restoring into '$DB' (existing collections are replaced)"
docker compose exec -T mongo mongorestore --archive --gzip --drop --quiet --nsInclude "$DB.*" < "$FILE"
rm -f "$FILE"
echo "Restore complete."
