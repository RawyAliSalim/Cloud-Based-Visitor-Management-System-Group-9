#!/usr/bin/env bash
# Visitor Registration Service (Rawy Ali Salim) on floci.
# AWS services: Lambda (vms-registration), API Gateway routes below, IAM role vms-registration-role,
# CloudWatch Logs /aws/lambda/vms-registration.

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
