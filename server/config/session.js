const session = require('express-session');
const MongoStore = require('connect-mongo');

const SESSION_TTL_SECONDS = 8 * 60 * 60;

// Cookies are "Secure" (HTTPS only) in production. The floci deployment runs on plain HTTP on
// your own PC, so it sets SESSION_COOKIE_SECURE=false; everything else keeps the default.
function cookieSecure() {
  if (process.env.SESSION_COOKIE_SECURE === 'true') return true;
  if (process.env.SESSION_COOKIE_SECURE === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

function createSession() {
  return session({
    name: 'vms.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      collectionName: 'sessions',
      ttl: SESSION_TTL_SECONDS
    }),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecure(),
      maxAge: SESSION_TTL_SECONDS * 1000
    }
  });
}

module.exports = createSession;
