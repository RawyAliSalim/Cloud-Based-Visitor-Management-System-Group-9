// Blocks NoSQL operator injection: a request like {"email": {"$ne": null}} would otherwise
// reach a MongoDB query as an operator. Keys starting with "$" or containing "." are refused.
const { sendError } = require('./validate');

const MAX_DEPTH = 10;

function findUnsafeKey(value, depth = 0) {
  if (depth > MAX_DEPTH) {
    return '(nested too deeply)';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUnsafeKey(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith('$') || key.includes('.') || key === '__proto__' || key === 'constructor') {
        return key;
      }
      const found = findUnsafeKey(child, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function sanitizeInput(req, res, next) {
  const unsafe = findUnsafeKey(req.body) || findUnsafeKey(req.query) || findUnsafeKey(req.params);
  if (unsafe) {
    return sendError(res, 400, 'INVALID_INPUT', 'Request contains a field name that is not allowed');
  }
  return next();
}

module.exports = { sanitizeInput, findUnsafeKey };
