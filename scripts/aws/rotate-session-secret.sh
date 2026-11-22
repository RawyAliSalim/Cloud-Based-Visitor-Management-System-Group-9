#!/usr/bin/env bash
# Replaces SESSION_SECRET in Secrets Manager with a new random value (signs everyone out once
# the API is restarted). Secrets Manager keeps the previous version as AWSPREVIOUS.
source "$(dirname "$0")/common.sh"
require_floci

aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --query SecretString --output text > "$WORK_DIR/secret.json"
node - "$(random_secret)" <<'NODE'
const fs = require('fs');
const file = '.aws-work/secret.json';
const secret = JSON.parse(fs.readFileSync(file, 'utf8'));
secret.SESSION_SECRET = process.argv[2];
fs.writeFileSync(file, JSON.stringify(secret));
NODE
VERSION=$(aws secretsmanager put-secret-value --secret-id "$SECRET_ID" --secret-string "file://$WORK_DIR/secret.json" --query VersionId --output text)
rm -f "$WORK_DIR/secret.json"
echo "SESSION_SECRET rotated (new version $VERSION)."
echo "Apply it: bash scripts/aws/secrets-to-env.sh && docker compose up -d --force-recreate api"
