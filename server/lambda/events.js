// Non-HTTP Lambda events (queues, schedules). The deployment base has none; services that
// subscribe to AWS events handle them here.
const logger = require('../utils/logger');

async function handle(event) {
  logger.warn('lambda.unsupported_event', { keys: Object.keys(event || {}).join(',') });
  return { ignored: true };
}

module.exports = { handle };
