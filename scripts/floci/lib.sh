#!/usr/bin/env bash
# Shared settings for the floci deployment scripts (AWS CLI v2 against the local floci emulator).
# Reuses scripts/aws/common.sh: local endpoint only, dummy credentials, AWS CLI v2 check.
source "$(dirname "${BASH_SOURCE[0]}")/../aws/common.sh"

# Git Bash on Windows rewrites arguments that start with "/" (e.g. /aws/lambda/...) into Windows
# paths before they reach aws.exe. Turn that off; it has no effect on macOS/Linux.
export MSYS_NO_PATHCONV=1

ACCOUNT_ID="000000000000"
API_ID="vmsapi"
API_URL="http://${API_ID}.execute-api.localhost.floci.io:4566"
WEB_BUCKET="vms-web"
WEB_URL="http://${WEB_BUCKET}.s3-website.localhost.floci.io:4566"
ARTIFACT_BUCKET="vms-deploy-artifacts"
APP_SECRET_ID="vms/floci/app-config"
LAMBDA_RUNTIME="nodejs22.x"
SERVICES=(notifications registration checkin)
BUILD_DIR=".floci-build"

function_name() { echo "vms-$1"; }
role_name() { echo "vms-$1-role"; }
log_group() { echo "/aws/lambda/vms-$1"; }
function_arn() { echo "arn:aws:lambda:${AWS_REGION}:${ACCOUNT_ID}:function:$(function_name "$1")"; }

require_lambda_runtime() {
  if ! aws lambda list-functions >/dev/null 2>&1; then
    echo "floci is not reachable on $AWS_ENDPOINT_URL. Start it: docker compose up -d floci" >&2
    exit 1
  fi
}

# Read a JSON field from a file without printing secrets anywhere else.
json_field() {
  node -e "const v=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))[process.argv[2]];process.stdout.write(v==null?'':String(v))" "$1" "$2"
}
