#!/usr/bin/env bash
# Deploys the whole Visitor Management System to floci with AWS CLI v2:
#   S3 (code package + website), IAM (one least-privilege role per service), Lambda (one function
#   per service), CloudWatch Logs (log group per function), API Gateway (HTTP API routing each
#   route to its service), plus each service's own resources from scripts/floci/services/<name>.sh.
# Safe to run again: everything is created or updated in place. Run configure.sh first.
source "$(dirname "$0")/lib.sh"
require_lambda_runtime

if ! aws secretsmanager describe-secret --secret-id "$APP_SECRET_ID" >/dev/null 2>&1; then
  echo "Secret $APP_SECRET_ID not found. Run: bash scripts/floci/configure.sh" >&2
  exit 1
fi

# ---------- helpers used by scripts/floci/services/*.sh ----------
env_file() { echo "$WORK_DIR/env-$1.txt"; }
policy_file() { echo "$WORK_DIR/policy-$1.txt"; }
add_env_for() { echo "$2=$3" >> "$(env_file "$1")"; }       # service, KEY, VALUE
add_policy_for() { echo "$2" >> "$(policy_file "$1")"; }     # service, IAM statement JSON
ensure_bucket() {                                             # private, encrypted bucket
  local bucket="$1"
  aws s3api head-bucket --bucket "$bucket" >/dev/null 2>&1 || aws s3api create-bucket --bucket "$bucket" >/dev/null
  aws s3api put-public-access-block --bucket "$bucket" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-encryption --bucket "$bucket" --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
}

for service in "${SERVICES[@]}"; do
  : > "$(env_file "$service")"
  : > "$(policy_file "$service")"
  source "$(dirname "$0")/services/$service.sh"
done

# ---------- 1. Build one code package for all three functions ----------
echo "== Building the Lambda package"
LOCK_HASH=$(node -e "const c=require('crypto').createHash('sha256');c.update(require('fs').readFileSync('package-lock.json'));console.log(c.digest('hex'))")
# Production dependencies are reinstalled only when package-lock.json changed (saves minutes).
if [[ "$(cat "$BUILD_DIR/pkg/.lock-hash" 2>/dev/null)" != "$LOCK_HASH" ]]; then
  rm -rf "$BUILD_DIR" && mkdir -p "$BUILD_DIR/pkg"
  cp package.json package-lock.json "$BUILD_DIR/pkg/"
  (cd "$BUILD_DIR/pkg" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error >/dev/null)
  echo "$LOCK_HASH" > "$BUILD_DIR/pkg/.lock-hash"
fi
rm -rf "$BUILD_DIR/pkg/server" "$BUILD_DIR/pkg/api" "$BUILD_DIR/vms-api.zip"
cp -r server api package.json "$BUILD_DIR/pkg/"
if command -v zip >/dev/null 2>&1; then
  (cd "$BUILD_DIR/pkg" && zip -qr ../vms-api.zip .)
else
  (cd "$BUILD_DIR/pkg" && /c/Windows/System32/tar.exe -a -c -f ../vms-api.zip *)
fi
SHA=$(node -e "const c=require('crypto').createHash('sha256');c.update(require('fs').readFileSync(process.argv[1]));console.log(c.digest('hex').slice(0,12))" "$BUILD_DIR/vms-api.zip")
CODE_KEY="lambda/vms-api-$SHA.zip"
ensure_bucket "$ARTIFACT_BUCKET"
aws s3 cp "$BUILD_DIR/vms-api.zip" "s3://$ARTIFACT_BUCKET/$CODE_KEY" --only-show-errors
echo "   s3://$ARTIFACT_BUCKET/$CODE_KEY ($(wc -c < "$BUILD_DIR/vms-api.zip" | tr -d ' ') bytes)"

# ---------- 2. Each service's own resources ----------
for service in "${SERVICES[@]}"; do
  echo "== Preparing $service resources"
  "prepare_$service"
done

# ---------- 3. Shared configuration for every function ----------
# Secrets are not copied into the functions' environment variables: each function gets only the
# secret's name (VMS_SECRET_ID) and its IAM role may read exactly that secret (server/lambda/init.js).
SECRET_ARN=$(aws secretsmanager describe-secret --secret-id "$APP_SECRET_ID" --query ARN --output text)
for service in "${SERVICES[@]}"; do
  add_policy_for "$service" "{\"Effect\":\"Allow\",\"Action\":[\"secretsmanager:GetSecretValue\"],\"Resource\":\"$SECRET_ARN\"}"
done
node - "$APP_SECRET_ID" "$WEB_URL" > "$WORK_DIR/shared-env.json" <<'NODE'
const secretId = process.argv[2];
const webUrl = process.argv[3];
process.stdout.write(JSON.stringify({
  NODE_ENV: 'production',
  LOG_LEVEL: 'info',
  SESSION_COOKIE_SECURE: 'false',
  CORS_ORIGINS: webUrl,
  APP_URL: webUrl,
  AWS_ENDPOINT_URL: 'http://floci:4566',
  NOTIFICATION_RETRY_INTERVAL_SECONDS: '0',
  VMS_SECRET_ID: secretId
}));
NODE

# ---------- 4. IAM role, log group and Lambda function per service ----------
TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
for service in "${SERVICES[@]}"; do
  fn=$(function_name "$service"); role=$(role_name "$service"); lg=$(log_group "$service")
  echo "== Deploying Lambda $fn"
  aws iam get-role --role-name "$role" >/dev/null 2>&1 || \
    aws iam create-role --role-name "$role" --assume-role-policy-document "$TRUST" \
      --description "Least-privilege role for the $service service" >/dev/null
  {
    echo '{"Version":"2012-10-17","Statement":['
    echo "{\"Effect\":\"Allow\",\"Action\":[\"logs:CreateLogStream\",\"logs:PutLogEvents\"],\"Resource\":\"arn:aws:logs:$AWS_REGION:$ACCOUNT_ID:log-group:$lg:*\"}"
    while IFS= read -r statement; do [[ -n "$statement" ]] && echo ",$statement"; done < "$(policy_file "$service")"
    echo ']}'
  } > "$WORK_DIR/policy-$service.json"
  aws iam put-role-policy --role-name "$role" --policy-name "vms-$service-policy" \
    --policy-document "file://$WORK_DIR/policy-$service.json"

  aws logs create-log-group --log-group-name "$lg" >/dev/null 2>&1 || true
  aws logs put-retention-policy --log-group-name "$lg" --retention-in-days 14

  add_env_for "$service" VMS_SERVICE "$service"
  node scripts/floci/env-json.js "$WORK_DIR/shared-env.json" "$(env_file "$service")" > "$WORK_DIR/env-$service.json"

  if aws lambda get-function --function-name "$fn" >/dev/null 2>&1; then
    aws lambda update-function-code --function-name "$fn" --s3-bucket "$ARTIFACT_BUCKET" --s3-key "$CODE_KEY" >/dev/null
    aws lambda update-function-configuration --function-name "$fn" --timeout 30 --memory-size 512 \
      --role "arn:aws:iam::$ACCOUNT_ID:role/$role" --environment "file://$WORK_DIR/env-$service.json" >/dev/null
  else
    aws lambda create-function --function-name "$fn" --runtime "$LAMBDA_RUNTIME" --handler api/lambda.handler \
      --role "arn:aws:iam::$ACCOUNT_ID:role/$role" --code "S3Bucket=$ARTIFACT_BUCKET,S3Key=$CODE_KEY" \
      --timeout 30 --memory-size 512 --description "Visitor Management System - $service service" \
      --environment "file://$WORK_DIR/env-$service.json" >/dev/null
  fi
  rm -f "$WORK_DIR/env-$service.json"
done
rm -f "$WORK_DIR/shared-env.json"

# ---------- 5. API Gateway: one HTTP API, each route goes to the service that owns it ----------
echo "== API Gateway $API_URL"
aws apigatewayv2 delete-api --api-id "$API_ID" >/dev/null 2>&1 || true
aws apigatewayv2 create-api --name vms-api --protocol-type HTTP \
  --tags "{\"floci:override-id\":\"$API_ID\",\"project\":\"visitor-management\"}" >/dev/null
for service in "${SERVICES[@]}"; do
  integration=$(aws apigatewayv2 create-integration --api-id "$API_ID" --integration-type AWS_PROXY \
    --integration-uri "$(function_arn "$service")" --payload-format-version 2.0 --query IntegrationId --output text)
  while IFS= read -r route; do
    [[ -z "$route" ]] && continue
    aws apigatewayv2 create-route --api-id "$API_ID" --route-key "$route" --target "integrations/$integration" >/dev/null
    echo "   $route -> $(function_name "$service")"
  done < <("routes_$service")
  aws lambda add-permission --function-name "$(function_name "$service")" --statement-id apigateway-invoke \
    --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:$AWS_REGION:$ACCOUNT_ID:$API_ID/*" >/dev/null 2>&1 || true
done
aws apigatewayv2 create-stage --api-id "$API_ID" --stage-name '$default' --auto-deploy >/dev/null

# ---------- 6. Event wiring that needs the functions to exist ----------
for service in "${SERVICES[@]}"; do
  "after_$service"
done

# ---------- 7. Frontend: React build on an S3 static website ----------
echo "== Frontend $WEB_URL"
(cd client && VITE_API_BASE_URL="$API_URL" npx vite build --outDir dist-floci --emptyOutDir --logLevel error)
aws s3api head-bucket --bucket "$WEB_BUCKET" >/dev/null 2>&1 || aws s3api create-bucket --bucket "$WEB_BUCKET" >/dev/null
aws s3 sync client/dist-floci "s3://$WEB_BUCKET" --delete --only-show-errors
aws s3 website "s3://$WEB_BUCKET/" --index-document index.html --error-document index.html
# New buckets block public policies by default (as on AWS). This bucket is the public website,
# so only here is that block removed; the code, reports and backup buckets stay private.
aws s3api delete-public-access-block --bucket "$WEB_BUCKET" >/dev/null 2>&1 || true
aws s3api put-bucket-policy --bucket "$WEB_BUCKET" --policy \
  "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"PublicWebsite\",\"Effect\":\"Allow\",\"Principal\":\"*\",\"Action\":\"s3:GetObject\",\"Resource\":\"arn:aws:s3:::$WEB_BUCKET/*\"}]}"

echo
echo "Deployed. Open the app: $WEB_URL"
echo "API: $API_URL   (check: bash scripts/floci/smoke-test.sh)"
