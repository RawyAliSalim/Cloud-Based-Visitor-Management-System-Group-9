const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9][0-9\s-]{6,19}$/;

function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function isObjectId(value) {
  return typeof value === 'string' && OBJECT_ID_PATTERN.test(value);
}

function isEmail(value) {
  return typeof value === 'string' && EMAIL_PATTERN.test(value);
}

function isPhone(value) {
  return typeof value === 'string' && PHONE_PATTERN.test(value);
}

function requireJson(req, res, next) {
  if (!req.is('application/json')) {
    return sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }
  return next();
}

function validateIdParam(req, res, next) {
  if (!isObjectId(req.params.id)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Id is not valid');
  }
  return next();
}

module.exports = { sendError, isObjectId, isEmail, isPhone, requireJson, validateIdParam };
