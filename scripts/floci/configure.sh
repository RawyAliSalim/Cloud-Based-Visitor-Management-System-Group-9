#!/usr/bin/env bash
# Stores the deployment's secrets in AWS Secrets Manager (floci) as vms/floci/app-config.
# Asks for the database connection string and optional Brevo email settings; nothing is printed.
# Press Enter to keep the current value (or, for the database, to use the local Docker MongoDB).
# Non-interactive use: set VMS_MONGODB_URI / VMS_EMAIL_API_KEY / VMS_EMAIL_FROM before running.
source "$(dirname "$0")/lib.sh"
require_lambda_runtime

CURRENT="$WORK_DIR/current-secret.json"
echo '{}' > "$CURRENT"
if aws secretsmanager describe-secret --secret-id "$APP_SECRET_ID" >/dev/null 2>&1; then
  aws secretsmanager get-secret-value --secret-id "$APP_SECRET_ID" --query SecretString --output text > "$CURRENT"
  echo "Updating existing secret $APP_SECRET_ID (Enter keeps the current value)."
fi

ask_hidden() { # prompt, env override
  local value="${!2:-}"
  if [[ -z "$value" && -t 0 ]]; then
    read -r -s -p "$1: " value
    echo >&2
  fi
  printf '%s' "$value"
}

MONGODB_URI_IN="$(ask_hidden 'MongoDB connection string (Enter = keep current / local Docker MongoDB)' VMS_MONGODB_URI)"
EMAIL_API_KEY_IN="$(ask_hidden 'Brevo API key for arrival emails (optional, Enter = keep current / none)' VMS_EMAIL_API_KEY)"
EMAIL_FROM_IN="${VMS_EMAIL_FROM:-}"
if [[ -z "$EMAIL_FROM_IN" && -t 0 ]]; then
  read -r -p "Verified Brevo sender email (optional, Enter = keep current / none): " EMAIL_FROM_IN
fi

MONGODB_URI_IN="$MONGODB_URI_IN" EMAIL_API_KEY_IN="$EMAIL_API_KEY_IN" EMAIL_FROM_IN="$EMAIL_FROM_IN" \
node - "$CURRENT" > "$WORK_DIR/new-secret.json" <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const current = JSON.parse(fs.readFileSync(process.argv[2], 'utf8') || '{}');
const pick = (input, existing, fallback) => input || existing || fallback || '';
const secret = {
  MONGODB_URI: pick(process.env.MONGODB_URI_IN, current.MONGODB_URI, 'mongodb://mongo:27017/vms'),
  SESSION_SECRET: current.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  CRON_SECRET: current.CRON_SECRET || crypto.randomBytes(32).toString('hex'),
  EMAIL_API_KEY: pick(process.env.EMAIL_API_KEY_IN, current.EMAIL_API_KEY),
  EMAIL_FROM: pick(process.env.EMAIL_FROM_IN, current.EMAIL_FROM)
};
if (!/^mongodb(\+srv)?:\/\//.test(secret.MONGODB_URI)) {
  console.error('The MongoDB connection string must start with mongodb:// or mongodb+srv://');
  process.exit(1);
}
if (secret.MONGODB_URI.includes('<db_password>')) {
  console.error('Replace <db_password> in the connection string with the real password.');
  process.exit(1);
}
process.stdout.write(JSON.stringify(secret));
NODE

if aws secretsmanager describe-secret --secret-id "$APP_SECRET_ID" >/dev/null 2>&1; then
  aws secretsmanager put-secret-value --secret-id "$APP_SECRET_ID" --secret-string "file://$WORK_DIR/new-secret.json" >/dev/null
else
  aws secretsmanager create-secret --name "$APP_SECRET_ID" \
    --description "Visitor Management System floci deployment secrets" \
    --secret-string "file://$WORK_DIR/new-secret.json" >/dev/null
fi

DB_KIND=$(node -e "const s=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(s.MONGODB_URI.startsWith('mongodb+srv://')?'MongoDB Atlas':'local MongoDB ('+new URL(s.MONGODB_URI).host+')')" "$WORK_DIR/new-secret.json")
EMAIL_STATE=$(node -e "const s=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(s.EMAIL_API_KEY&&s.EMAIL_FROM?'configured':'not configured')" "$WORK_DIR/new-secret.json")
rm -f "$CURRENT" "$WORK_DIR/new-secret.json"
echo "Saved $APP_SECRET_ID in Secrets Manager. Database: $DB_KIND. Email: $EMAIL_STATE."
echo "Next: bash scripts/floci/deploy.sh"
