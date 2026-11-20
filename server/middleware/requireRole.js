const { sendError } = require('./validate');

function requireRole(...roles) {
  const allowed = new Set(roles);

  return function checkRole(req, res, next) {
    const user = req.session && req.session.user;

    if (!user) {
      return sendError(res, 401, 'UNAUTHORIZED', 'You must be logged in');
    }

    if (!allowed.has(user.role)) {
      return sendError(res, 403, 'FORBIDDEN', 'You do not have permission for this action');
    }

    return next();
  };
}

module.exports = requireRole;
