// Non-HTTP Lambda events for the Host Notification Service (floci deployment):
// - SQS: visitor arrivals put on the vms-arrivals queue by the check-in function
// - EventBridge Scheduler: {"action":"retry-due"} every minute, delivers due notification retries
// A failed SQS message makes the invocation fail, so SQS delivers it again; after 3 attempts the
// queue moves it to the dead-letter queue vms-arrivals-dlq for the team to inspect.
const connectDB = require('../config/db');
const logger = require('../utils/logger');
const notificationService = require('../services/notification.service');

function isSqsEvent(event) {
  return Array.isArray(event && event.Records) && event.Records.every((record) => record.eventSource === 'aws:sqs');
}

async function handleSqs(event) {
  const results = [];
  for (const record of event.Records) {
    let message;
    try {
      message = JSON.parse(record.body);
    } catch (error) {
      // A malformed message can never succeed: log it and drop it instead of retrying forever.
      logger.error('notification.arrival_bad_message', { messageId: record.messageId });
      results.push({ messageId: record.messageId, skipped: 'BAD_MESSAGE' });
      continue;
    }
    if (message.type !== 'visitor-arrival' || !message.visitId) {
      logger.error('notification.arrival_bad_message', { messageId: record.messageId });
      results.push({ messageId: record.messageId, skipped: 'BAD_MESSAGE' });
      continue;
    }
    const result = await notificationService.handleArrivalMessage(message);
    logger.info('notification.arrival_processed', {
      messageId: record.messageId,
      visitId: message.visitId,
      receiveCount: record.attributes && record.attributes.ApproximateReceiveCount,
      ...result,
      notified: result.notified ? result.notified.join(',') : undefined
    });
    results.push({ messageId: record.messageId, ...result });
  }
  return { processed: results.length, results };
}

async function handle(event) {
  if (isSqsEvent(event)) {
    await connectDB();
    return handleSqs(event);
  }
  if (event && event.action === 'retry-due') {
    await connectDB();
    const summary = await notificationService.processDueRetries({ limit: 50 });
    // One line per scheduled run (every minute), so CloudWatch shows the schedule working.
    logger.info('notification.retries_processed', { trigger: 'scheduler', ...summary });
    return summary;
  }
  logger.warn('lambda.unsupported_event', { keys: Object.keys(event || {}).join(',') });
  return { ignored: true };
}

module.exports = { handle, isSqsEvent };
