#!/usr/bin/env bash
# Visitor Registration Service (Rawy Ali Salim) on floci.
# AWS services: Lambda (vms-registration), API Gateway routes below, IAM role vms-registration-role,
# CloudWatch Logs /aws/lambda/vms-registration, Secrets Manager vms/floci/app-config (read at start-up by
# all functions, see server/lambda/init.js; deploy.sh grants each role read access to that one secret).

routes_registration() {
  cat <<'ROUTES'
POST /api/visits
PATCH /api/visits/{id}
POST /api/visits/{id}/cancel
GET /api/visitors
GET /api/visitors/{id}
ANY /api/auth/{proxy+}
GET /api/health
OPTIONS /{proxy+}
ROUTES
}

prepare_registration() { :; }
after_registration() { :; }
