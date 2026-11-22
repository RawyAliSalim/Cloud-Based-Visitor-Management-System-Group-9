const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const createSession = require('./config/session');
const { sendError } = require('./middleware/validate');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const requestLogger = require('./middleware/requestLogger');
const securityHeaders = require('./middleware/securityHeaders');
const sameOrigin = require('./middleware/sameOrigin');
const { sanitizeInput } = require('./middleware/sanitizeInput');
const logger = require('./utils/logger');
const authRoutes = require('./routes/auth.routes');
const visitorsRoutes = require('./routes/visitors.routes');
const visitsRoutes = require('./routes/visits.routes');
const checkinRoutes = require('./routes/checkin.routes');
const notificationRoutes = require('./routes/notifications.routes');

const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(requestLogger);
app.use(securityHeaders);
// CORS only controls which other websites may read responses; it is not the security layer.
// Security comes from the measures below and in docs/security.md.
app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : false, credentials: true }));
app.use(sameOrigin);
app.use(express.json({ limit: '100kb', strict: true }));
app.use(sanitizeInput);

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use(async (req, res, next) => {
  try {
    await connectDB();
    return next();
  } catch (error) {
    logger.error('db.connect_failed', { requestId: req.id, error: error.name });
    return sendError(res, 503, 'DATABASE_UNAVAILABLE', 'Database is not available');
  }
});

app.use(createSession());

app.use('/api/auth', authRoutes);
app.use('/api/visitors', visitorsRoutes);
app.use('/api/visits', visitsRoutes);
app.use('/api/visits', checkinRoutes);
app.use('/api/notifications', notificationRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
