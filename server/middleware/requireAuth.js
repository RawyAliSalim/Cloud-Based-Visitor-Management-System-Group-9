const { sendError } = require('./validate');

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return sendError(res, 401, 'UNAUTHORIZED', 'You must be logged in');
  }
  return next();
}

module.exports = requireAuth;
