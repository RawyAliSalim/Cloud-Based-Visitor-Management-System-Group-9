#!/usr/bin/env bash
# Creates the AWS resources the project uses (idempotent, safe to run again):
#  1. A private, encrypted, versioned S3 bucket for database backups (backups expire after 30 days)
#  2. A Secrets Manager secret holding the app's secrets (taken from .env, missing ones generated)
source "$(dirname "$0")/common.sh"
require_floci

echo "== S3 bucket: $BUCKET"
if aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  echo "   already exists"
else
  aws s3api create-bucket --bucket "$BUCKET" >/dev/null
  echo "   created"
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration \
  '{"Rules":[{"ID":"expire-old-backups","Status":"Enabled","Filter":{"Prefix":"mongo/"},"Expiration":{"Days":30},"NoncurrentVersionExpiration":{"NoncurrentDays":7}}]}' >/dev/null
echo "   public access blocked, AES-256 encryption, versioning on, 30-day expiry"

echo "== Secrets Manager: $SECRET_ID"
# Build the secret JSON from .env (if present) without printing any value.
SESSION_DEFAULT="$(random_secret)"
CRON_DEFAULT="$(random_secret)"
SEED_DEFAULT="Seed-$(random_secret | cut -c1-12)"
node - "$SESSION_DEFAULT" "$CRON_DEFAULT" "$SEED_DEFAULT" > "$WORK_DIR/secret.json" <<'NODE'
const fs = require('fs');
const [sessionDefault, cronDefault, seedDefault] = process.argv.slice(2);
const KEYS = ['SESSION_SECRET', 'SEED_PASSWORD', 'CRON_SECRET', 'EMAIL_API_KEY', 'EMAIL_FROM',
  'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];
const env = {};
if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && KEYS.includes(match[1]) && match[2] !== '') env[match[1]] = match[2].replace(/^"|"$/g, '');
  }
}
env.SESSION_SECRET = env.SESSION_SECRET || sessionDefault;
env.CRON_SECRET = env.CRON_SECRET || cronDefault;
env.SEED_PASSWORD = env.SEED_PASSWORD || seedDefault;
process.stdout.write(JSON.stringify(env));
NODE

if aws secretsmanager describe-secret --secret-id "$SECRET_ID" >/dev/null 2>&1; then
  echo "   already exists, left unchanged (use rotate-session-secret.sh to change SESSION_SECRET)"
else
  aws secretsmanager create-secret --name "$SECRET_ID" \
    --description "Visitor Management System local app secrets" \
    --secret-string "file://$WORK_DIR/secret.json" >/dev/null
  echo "   created with keys: $(node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('$WORK_DIR/secret.json','utf8'))).join(', '))")"
fi
rm -f "$WORK_DIR/secret.json"

echo "Done. Next: bash scripts/aws/secrets-to-env.sh"
