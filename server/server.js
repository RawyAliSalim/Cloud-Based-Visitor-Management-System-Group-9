const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = require('./app');

const PORT = process.env.PORT || 3000;

const connectDB = require('./config/db');
const { processDueRetries } = require('./services/notification.service');
const logger = require('./utils/logger');

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});

// Long-running mode (local / Docker): a background worker delivers due notification retries.
// On Vercel this file is not used; retries run via GET /api/notifications or POST /api/notifications/retry-due.
const intervalSeconds = Number(process.env.NOTIFICATION_RETRY_INTERVAL_SECONDS ?? 30);
if (intervalSeconds > 0) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await connectDB();
      const summary = await processDueRetries({ limit: 50 });
      if (summary.processed > 0) {
        logger.info('notification.retries_processed', { trigger: 'worker', ...summary });
      }
    } catch (error) {
      logger.warn('notification.retry_worker_failed', { error: error.message });
    } finally {
      running = false;
    }
  }, intervalSeconds * 1000);
  timer.unref();
}
