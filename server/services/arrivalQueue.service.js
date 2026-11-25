// Host Notification Service: hands visitor arrivals to an SQS queue (floci deployment).
// The check-in function only enqueues the arrival and answers the front desk immediately; the
// notifications function is triggered by the queue and does the slow part (email, push, retries).
// Active only when ARRIVALS_QUEUE_URL is set. The AWS SDK is part of the Lambda runtime.
const logger = require('../utils/logger');

let client = null;

function sqs() {
  if (!client) {
    const { SQSClient } = require('@aws-sdk/client-sqs');
    client = new SQSClient({});
  }
  return client;
}

function isEnabled() {
  return Boolean(process.env.ARRIVALS_QUEUE_URL);
}

async function sendArrival(visit) {
  const { SendMessageCommand } = require('@aws-sdk/client-sqs');
  const body = {
    type: 'visitor-arrival',
    visitId: String(visit._id),
    hostId: String(visit.hostId && visit.hostId._id ? visit.hostId._id : visit.hostId),
    checkedInAt: visit.checkInTime ? new Date(visit.checkInTime).toISOString() : new Date().toISOString()
  };
  const result = await sqs().send(
    new SendMessageCommand({
      QueueUrl: process.env.ARRIVALS_QUEUE_URL,
      MessageBody: JSON.stringify(body),
      MessageAttributes: { type: { DataType: 'String', StringValue: body.type } }
    })
  );
  logger.info('notification.arrival_queued', { visitId: body.visitId, messageId: result.MessageId });
  return result.MessageId;
}

module.exports = { isEnabled, sendArrival };
