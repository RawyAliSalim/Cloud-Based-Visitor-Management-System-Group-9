const session = require('express-session');
const MongoStore = require('connect-mongo');

const SESSION_TTL_SECONDS = 8 * 60 * 60;

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
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_TTL_SECONDS * 1000
    }
  });
}

module.exports = createSession;
