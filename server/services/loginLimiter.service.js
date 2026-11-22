// Brute-force protection for POST /api/auth/login.
// - 5 failed attempts for one email within 15 minutes lock that email for 15 minutes
// - 20 failed attempts from one IP address within 15 minutes block that IP for 15 minutes
// A successful sign-in clears the email counter.
const LoginAttempt = require('../models/LoginAttempt');

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function settings() {
  const windowMs = numberFromEnv('LOGIN_WINDOW_MINUTES', 15) * 60 * 1000;
  return {
    windowMs,
    lockMs: numberFromEnv('LOGIN_LOCK_MINUTES', 15) * 60 * 1000,
    maxPerEmail: numberFromEnv('LOGIN_MAX_ATTEMPTS_PER_EMAIL', 5),
    maxPerIp: numberFromEnv('LOGIN_MAX_ATTEMPTS_PER_IP', 20)
  };
}

function keysFor(email, ip) {
  return { email: `email:${String(email).toLowerCase()}`, ip: `ip:${ip || 'unknown'}` };
}

// Seconds until the email or IP may try again, or 0 if not locked.
async function lockedSeconds(email, ip) {
  const keys = keysFor(email, ip);
  const now = Date.now();
  const locked = await LoginAttempt.find({ key: { $in: [keys.email, keys.ip] }, lockedUntil: { $gt: new Date(now) } })
    .select('lockedUntil')
    .lean();
  if (locked.length === 0) {
    return 0;
  }
  const until = Math.max(...locked.map((doc) => new Date(doc.lockedUntil).getTime()));
  return Math.ceil((until - now) / 1000);
}

async function recordFailure(key, max, config) {
  const now = new Date();
  const doc = await LoginAttempt.findOneAndUpdate(
    { key },
    { $inc: { count: 1 }, $setOnInsert: { firstAt: now }, $set: { expireAt: new Date(now.getTime() + config.windowMs + config.lockMs) } },
    { upsert: true, new: true }
  );

  if (now - doc.firstAt > config.windowMs) {
    // The old window has passed: start counting again from this failure.
    await LoginAttempt.updateOne({ key }, { $set: { count: 1, firstAt: now, lockedUntil: null } });
    return false;
  }
  if (doc.count >= max) {
    await LoginAttempt.updateOne({ key }, { $set: { lockedUntil: new Date(now.getTime() + config.lockMs) } });
    return true;
  }
  return false;
}

// Returns true if this failure caused a lock.
async function recordFailedLogin(email, ip) {
  const config = settings();
  const keys = keysFor(email, ip);
  const [emailLocked, ipLocked] = await Promise.all([
    recordFailure(keys.email, config.maxPerEmail, config),
    recordFailure(keys.ip, config.maxPerIp, config)
  ]);
  return emailLocked || ipLocked;
}

async function recordSuccessfulLogin(email) {
  await LoginAttempt.deleteOne({ key: keysFor(email).email });
}

module.exports = { lockedSeconds, recordFailedLogin, recordSuccessfulLogin, settings };
