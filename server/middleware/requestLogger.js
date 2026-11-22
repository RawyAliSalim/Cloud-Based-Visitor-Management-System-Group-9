const crypto = require('crypto');
const logger = require('../utils/logger');

// Gives every request an id (returned in X-Request-Id) and logs one line when it finishes.
function requestLogger(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.set('X-Request-Id', req.id);

  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    const user = req.session && req.session.user;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]('http.request', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      userId: user ? user._id : undefined,
      role: user ? user.role : undefined
    });
  });

  next();
}

module.exports = requestLogger;
