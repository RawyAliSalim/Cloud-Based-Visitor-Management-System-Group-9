const User = require('../models/User');
const logger = require('../utils/logger');
const { sendError } = require('./validate');

// Checks the session AND that the account still exists and is active, so deactivating a
// user (or changing their role) takes effect on their next request, not when the session expires.
async function requireAuth(req, res, next) {
  try {
    const sessionUser = req.session && req.session.user;
    if (!sessionUser) {
      return sendError(res, 401, 'UNAUTHORIZED', 'You must be logged in');
    }

    const user = await User.findById(sessionUser._id).select('name role active').lean();
    if (!user || !user.active) {
      logger.warn('auth.session_revoked', { requestId: req.id, userId: sessionUser._id });
      await new Promise((resolve) => req.session.destroy(() => resolve()));
      res.clearCookie('vms.sid');
      return sendError(res, 401, 'ACCOUNT_DISABLED', 'Your account is no longer active');
    }

    if (user.role !== sessionUser.role || user.name !== sessionUser.name) {
      req.session.user = { ...sessionUser, role: user.role, name: user.name };
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = requireAuth;
