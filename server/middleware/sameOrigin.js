// CSRF protection for cookie-based sessions. Browsers send an Origin header with every
// state-changing request; if it is present it must be this site (or a configured front end).
// The session cookie is also SameSite=Lax, so other sites cannot send it with a POST.
// Requests without Origin (Postman, curl, schedulers) carry no browser cookies and are allowed.
const { sendError } = require('./validate');
const logger = require('../utils/logger');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function trustedOrigins() {
  const list = (process.env.CORS_ORIGINS || '').split(',');
  if (process.env.APP_URL) {
    list.push(process.env.APP_URL);
  }
  return new Set(list.map((origin) => origin.trim().replace(/\/$/, '')).filter(Boolean));
}

function originHost(origin) {
  try {
    return new URL(origin).host;
  } catch (error) {
    return null;
  }
}

function sameOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }
  const origin = req.get('origin');
  if (!origin) {
    return next();
  }
  const host = req.get('x-forwarded-host') || req.get('host');
  if (originHost(origin) === host || trustedOrigins().has(origin.replace(/\/$/, ''))) {
    return next();
  }
  logger.warn('security.cross_site_request_blocked', { requestId: req.id, method: req.method, path: req.path, origin });
  return sendError(res, 403, 'CROSS_SITE_REQUEST', 'Request from another site was blocked');
}

module.exports = sameOrigin;
