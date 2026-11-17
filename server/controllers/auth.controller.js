const bcrypt = require('bcryptjs');
const userService = require('../services/user.service');
const { sendError } = require('../middleware/validate');

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

    if (!email || !password) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Email and password are required');
    }

    const user = await userService.findByEmailWithPassword(email);
    const valid = Boolean(user && user.active && (await bcrypt.compare(password, user.passwordHash)));

    if (!valid) {
      return sendError(res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }

    await regenerateSession(req);
    req.session.user = { _id: String(user._id), name: user.name, role: user.role };
    await saveSession(req);

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
