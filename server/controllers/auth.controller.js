const bcrypt = require('bcryptjs');
const userService = require('../services/user.service');
const loginLimiter = require('../services/loginLimiter.service');
const logger = require('../utils/logger');
const { sendError } = require('../middleware/validate');

// bcrypt hash of a random value; only used to keep failed-login timing constant.
const DUMMY_HASH = '$2a$10$MwIb6.Co.1rnGhgY//d14erm0qZ3LyphLNI3q4bhSScJBeiuwtMoq';

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

async function login(req, res, next) {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!email || !password || email.length > 254 || password.length > 128) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Email and password are required');
    }

    const wait = await loginLimiter.lockedSeconds(email, req.ip);
    if (wait > 0) {
      logger.warn('auth.login_blocked', { requestId: req.id, ip: req.ip, retryAfterSeconds: wait });
      res.set('Retry-After', String(wait));
      return sendError(res, 429, 'TOO_MANY_ATTEMPTS', `Too many failed sign-in attempts. Try again in ${Math.ceil(wait / 60)} minutes.`);
    }

    const user = await userService.findByEmailWithPassword(email);
    // Compare against a dummy hash when the account does not exist, so the response time
    // does not reveal which emails are registered.
    const matches = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
    const valid = Boolean(user && user.active && matches);

    if (!valid) {
      const locked = await loginLimiter.recordFailedLogin(email, req.ip);
      logger.warn('auth.login_failed', { requestId: req.id, ip: req.ip, locked });
      return sendError(res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }

    await loginLimiter.recordSuccessfulLogin(email);

    // A new session id on sign-in prevents session fixation.
    await regenerateSession(req);
    req.session.user = { _id: String(user._id), name: user.name, role: user.role };
    await saveSession(req);
    logger.info('auth.login_succeeded', { requestId: req.id, userId: String(user._id), role: user.role });

    return res.status(200).json({ user: req.session.user });
  } catch (error) {
    return next(error);
  }
}

async function logout(req, res, next) {
  try {
    if (req.session) {
      await destroySession(req);
    }
    res.clearCookie('vms.sid');
    return res.status(200).json({ message: 'Logged out' });
  } catch (error) {
    return next(error);
  }
}

async function me(req, res) {
  return res.status(200).json({ user: req.session.user });
}

async function listHosts(req, res, next) {
  try {
    const hosts = await userService.listActiveHosts();
    return res.status(200).json(hosts);
  } catch (error) {
    return next(error);
  }
}

module.exports = { login, logout, me, listHosts };
