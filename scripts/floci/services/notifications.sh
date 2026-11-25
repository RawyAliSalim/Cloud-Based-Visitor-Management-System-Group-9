#!/usr/bin/env bash
# Host Notification Service (Mohamed Haytham) on floci.
# AWS services: Lambda (vms-notifications), API Gateway routes below, IAM role vms-notifications-role,
# CloudWatch Logs /aws/lambda/vms-notifications,
# SQS queue vms-arrivals (check-in -> notifications) with dead-letter queue vms-arrivals-dlq,
# EventBridge Scheduler schedule vms-notification-retries (delivers due retries every minute).

ARRIVALS_QUEUE="vms-arrivals"
ARRIVALS_DLQ="vms-arrivals-dlq"
RETRY_SCHEDULE="vms-notification-retries"
SCHEDULER_ROLE="vms-scheduler-role"

routes_notifications() {
  cat <<'ROUTES'
ANY /api/notifications
ANY /api/notifications/{proxy+}
ROUTES
}

queue_arn() { echo "arn:aws:sqs:$AWS_REGION:$ACCOUNT_ID:$1"; }

prepare_notifications() {
  # Dead-letter queue: arrivals that failed 3 times are kept 14 days for inspection.
  aws sqs create-queue --queue-name "$ARRIVALS_DLQ" --attributes MessageRetentionPeriod=1209600 >/dev/null
  # Main queue. Visibility timeout (180 s) is 6x the function timeout, as AWS recommends.
  aws sqs create-queue --queue-name "$ARRIVALS_QUEUE" >/dev/null
  local url
  url=$(aws sqs get-queue-url --queue-name "$ARRIVALS_QUEUE" --query QueueUrl --output text)
  cat > "$WORK_DIR/arrivals-attributes.json" <<JSON
{"VisibilityTimeout":"180","MessageRetentionPeriod":"86400","RedrivePolicy":"{\"deadLetterTargetArn\":\"$(queue_arn "$ARRIVALS_DLQ")\",\"maxReceiveCount\":\"3\"}"}
JSON
  aws sqs set-queue-attributes --queue-url "$url" --attributes "file://$WORK_DIR/arrivals-attributes.json"
  rm -f "$WORK_DIR/arrivals-attributes.json"

  # The check-in function may only send to the queue; the notifications function may only consume it.
  add_env_for checkin ARRIVALS_QUEUE_URL "$url"
  add_policy_for checkin "{\"Effect\":\"Allow\",\"Action\":[\"sqs:SendMessage\"],\"Resource\":\"$(queue_arn "$ARRIVALS_QUEUE")\"}"
  add_policy_for notifications "{\"Effect\":\"Allow\",\"Action\":[\"sqs:ReceiveMessage\",\"sqs:DeleteMessage\",\"sqs:GetQueueAttributes\",\"sqs:ChangeMessageVisibility\"],\"Resource\":\"$(queue_arn "$ARRIVALS_QUEUE")\"}"
  echo "   SQS $ARRIVALS_QUEUE (dead-letter queue $ARRIVALS_DLQ after 3 failed attempts)"
}

after_notifications() {
  local fn
  fn=$(function_name notifications)

  # SQS -> Lambda trigger (one message per invocation, so one bad message cannot fail others).
  for uuid in $(aws lambda list-event-source-mappings --function-name "$fn" --query 'EventSourceMappings[].UUID' --output text); do
    aws lambda delete-event-source-mapping --uuid "$uuid" >/dev/null
  done
  aws lambda create-event-source-mapping --function-name "$fn" --event-source-arn "$(queue_arn "$ARRIVALS_QUEUE")" \
    --batch-size 1 >/dev/null
  echo "   trigger: SQS $ARRIVALS_QUEUE -> $fn"

  # EventBridge Scheduler: deliver due notification retries every minute (no always-on server needed).
  aws iam get-role --role-name "$SCHEDULER_ROLE" >/dev/null 2>&1 || \
    aws iam create-role --role-name "$SCHEDULER_ROLE" --description "EventBridge Scheduler may invoke the notifications function" \
      --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"scheduler.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam put-role-policy --role-name "$SCHEDULER_ROLE" --policy-name invoke-notifications \
    --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"lambda:InvokeFunction\",\"Resource\":\"$(function_arn notifications)\"}]}"
  aws scheduler delete-schedule --name "$RETRY_SCHEDULE" >/dev/null 2>&1 || true
  cat > "$WORK_DIR/schedule-target.json" <<JSON
{"Arn":"$(function_arn notifications)","RoleArn":"arn:aws:iam::$ACCOUNT_ID:role/$SCHEDULER_ROLE","Input":"{\"action\":\"retry-due\"}"}
JSON
  aws scheduler create-schedule --name "$RETRY_SCHEDULE" --schedule-expression "rate(1 minute)" \
    --flexible-time-window Mode=OFF --target "file://$WORK_DIR/schedule-target.json" \
    --description "Deliver due host-notification retries" >/dev/null
  rm -f "$WORK_DIR/schedule-target.json"
  echo "   schedule: $RETRY_SCHEDULE rate(1 minute) -> $fn"
}
