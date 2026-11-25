#!/usr/bin/env bash
# Quick checks that the floci deployment answers: website, each Lambda through API Gateway,
# CORS for the website, and the AWS resources that should exist.
source "$(dirname "$0")/lib.sh"

fail=0
check() { # description, expected, actual
  if [[ "$3" == "$2" ]]; then echo "  ok   $1 ($3)"; else echo "  FAIL $1 (expected $2, got $3)"; fail=1; fi
}
code() { curl -s -o /dev/null -m 60 -w '%{http_code}' "$@"; }

echo "== Website"
check "S3 website serves the app" 200 "$(code "$WEB_URL/")"
echo "== API Gateway -> Lambda (first calls can take a while: cold start)"
check "registration: GET /api/health" 200 "$(code "$API_URL/api/health")"
check "registration: login with wrong password is refused" 401 "$(code -X POST -H 'Content-Type: application/json' -d '{"email":"nobody@vms.local","password":"wrong-password"}' "$API_URL/api/auth/login")"
check "checkin: GET /api/visits needs a session" 401 "$(code "$API_URL/api/visits")"
check "notifications: GET /api/notifications needs a session" 401 "$(code "$API_URL/api/notifications")"
check "CORS preflight from the website" 204 "$(code -X OPTIONS -H "Origin: $WEB_URL" -H 'Access-Control-Request-Method: POST' "$API_URL/api/auth/login")"
check "request from another website is blocked" 403 "$(code -X POST -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -d '{}' "$API_URL/api/auth/logout")"

echo "== AWS resources"
check "Lambda functions" 3 "$(aws lambda list-functions --query "length(Functions[?starts_with(FunctionName,'vms-')])" --output text)"
check "CloudWatch log groups" 3 "$(aws logs describe-log-groups --log-group-name-prefix /aws/lambda/vms- --query 'length(logGroups)' --output text)"
check "IAM roles (3 functions + scheduler)" 4 "$(aws iam list-roles --query "length(Roles[?starts_with(RoleName,'vms-')])" --output text)"
check "SQS queues (arrivals + dead-letter)" 2 "$(aws sqs list-queues --queue-name-prefix vms-arrivals --query 'length(QueueUrls)' --output text)"
check "SQS -> notifications trigger" 1 "$(aws lambda list-event-source-mappings --function-name vms-notifications --query 'length(EventSourceMappings)' --output text)"
check "EventBridge retry schedule" ENABLED "$(aws scheduler get-schedule --name vms-notification-retries --query State --output text)"

[[ $fail -eq 0 ]] && echo "All checks passed." || { echo "Some checks failed."; exit 1; }
