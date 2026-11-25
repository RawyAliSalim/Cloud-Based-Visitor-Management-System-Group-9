#!/usr/bin/env bash
# Host Notification Service (Mohamed Haytham) on floci.
# AWS services: Lambda (vms-notifications), API Gateway routes below, IAM role vms-notifications-role,
# CloudWatch Logs /aws/lambda/vms-notifications.

routes_notifications() {
  cat <<'ROUTES'
ANY /api/notifications
ANY /api/notifications/{proxy+}
ROUTES
}

prepare_notifications() { :; }
after_notifications() { :; }
