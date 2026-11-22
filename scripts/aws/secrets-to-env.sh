#!/usr/bin/env bash
# Reads the app secrets from AWS Secrets Manager and writes .env.docker (git-ignored),
# which docker-compose loads into the API container. Values are never printed.
source "$(dirname "$0")/common.sh"
require_floci

aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --query SecretString --output text > "$WORK_DIR/secret.json"
node - > .env.docker <<'NODE'
const secret = JSON.parse(require('fs').readFileSync('.aws-work/secret.json', 'utf8'));
const lines = ['# Generated from AWS Secrets Manager by scripts/aws/secrets-to-env.sh - do not commit'];
for (const [key, value] of Object.entries(secret)) {
  lines.push(`${key}=${String(value).replace(/\r?\n/g, '\\n')}`);
}
process.stdout.write(lines.join('\n') + '\n');
NODE
rm -f "$WORK_DIR/secret.json"
chmod 600 .env.docker 2>/dev/null || true

echo "Wrote .env.docker with keys: $(grep -oE '^[A-Z0-9_]+' .env.docker | paste -sd, - | sed 's/,/, /g')"
echo "Restart the API to use them: docker compose up -d --force-recreate api"
