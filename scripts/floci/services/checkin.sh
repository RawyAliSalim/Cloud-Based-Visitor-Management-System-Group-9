#!/usr/bin/env bash
# Check-in/Check-out and Visitor Log Service (Mostafa Raafat Mohamed) on floci.
# AWS services: Lambda (vms-checkin), API Gateway routes below, IAM role vms-checkin-role,
# CloudWatch Logs /aws/lambda/vms-checkin, S3 bucket vms-reports (archive of exported CSV reports).

REPORTS_BUCKET="vms-reports"

routes_checkin() {
  cat <<'ROUTES'
GET /api/visits
GET /api/visits/{proxy+}
POST /api/visits/{id}/check-in
POST /api/visits/{id}/check-out
ROUTES
}

prepare_checkin() {
  ensure_bucket "$REPORTS_BUCKET"
  # Keep exported reports for one year.
  aws s3api put-bucket-lifecycle-configuration --bucket "$REPORTS_BUCKET" --lifecycle-configuration \
    '{"Rules":[{"ID":"expire-reports","Status":"Enabled","Filter":{"Prefix":"reports/"},"Expiration":{"Days":365}}]}' >/dev/null
  add_env_for checkin REPORTS_BUCKET "$REPORTS_BUCKET"
  # The check-in function may only add report files, not read or delete them.
  add_policy_for checkin "{\"Effect\":\"Allow\",\"Action\":[\"s3:PutObject\"],\"Resource\":\"arn:aws:s3:::$REPORTS_BUCKET/reports/*\"}"
  echo "   s3://$REPORTS_BUCKET (private, AES-256, reports kept 365 days)"
}

after_checkin() { :; }
