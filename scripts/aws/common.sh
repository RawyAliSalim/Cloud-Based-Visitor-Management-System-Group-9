#!/usr/bin/env bash
# Shared settings for the AWS CLI v2 scripts. By default everything goes to floci, the local
# AWS emulator from docker-compose (http://localhost:4566), so nothing reaches real AWS or costs money.
set -euo pipefail

cd "$(dirname "$0")/../.."

export AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="$AWS_REGION"
export AWS_PAGER=""

# floci accepts any credentials; use dummy ones unless a profile or keys were given.
if [[ -z "${AWS_PROFILE:-}" && -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  export AWS_ACCESS_KEY_ID=test
  export AWS_SECRET_ACCESS_KEY=test
fi

# Safety: refuse to touch real AWS unless explicitly allowed.
if [[ ! "$AWS_ENDPOINT_URL" =~ ^http://(localhost|127\.0\.0\.1|floci)(:[0-9]+)?/?$ && "${ALLOW_REAL_AWS:-}" != "true" ]]; then
  echo "AWS_ENDPOINT_URL is not local ($AWS_ENDPOINT_URL). Set ALLOW_REAL_AWS=true to use real AWS." >&2
  exit 1
fi

BUCKET="${VMS_BACKUP_BUCKET:-vms-backups-local}"
SECRET_ID="${VMS_SECRET_ID:-vms/local/app-config}"
WORK_DIR=".aws-work"
mkdir -p "$WORK_DIR"

require_aws_cli_v2() {
  if ! command -v aws >/dev/null 2>&1; then
    echo "AWS CLI v2 is not installed: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html" >&2
    exit 1
  fi
  if [[ "$(aws --version 2>&1)" != aws-cli/2.* ]]; then
    echo "AWS CLI v2 is required (found: $(aws --version 2>&1))" >&2
    exit 1
  fi
}

require_floci() {
  if ! aws s3api list-buckets >/dev/null 2>&1; then
    echo "Cannot reach $AWS_ENDPOINT_URL. Start it with: docker compose up -d floci" >&2
    exit 1
  fi
}

random_secret() {
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
}

require_aws_cli_v2
