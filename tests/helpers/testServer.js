// Starts the real Express app on a random port against a throw-away MongoDB database.
// Each test file gets its own database, so files can run in parallel.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const PASSWORD = 'Test-Password-123';

const USERS = {
  admin: { name: 'Test Admin', email: 'admin@test.local', role: 'admin' },
  frontDesk: { name: 'Test Front Desk', email: 'frontdesk@test.local', role: 'front-desk' },
  host1: { name: 'Host One', email: 'host1@test.local', role: 'host' },
  host2: { name: 'Host Two', email: 'host2@test.local', role: 'host' },
  inactiveHost: { name: 'Inactive Host', email: 'inactive@test.local', role: 'host', active: false }
};

function testDatabaseUri(name) {
  const base = (process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017').replace(/\/+$/, '');
  if (base.startsWith('mongodb+srv://') && process.env.TEST_ALLOW_REMOTE_DB !== 'true') {
    throw new Error('Refusing to run tests against a remote cluster. Use a local MongoDB (docker compose up -d mongo).');
  }
  const suffix = crypto.randomBytes(4).toString('hex');
  return `${base}/vms_test_${name.replace(/\W/g, '_')}_${suffix}`;
}

class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = null;
  }

  async request(method, path, body, headers = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...headers
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    const sessionCookie = setCookie.find((value) => value.startsWith('vms.sid='));
    if (sessionCookie) {
      this.cookie = sessionCookie.split(';')[0];
    }

    const text = await response.text();
    let data = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (error) {
      // keep raw text (for CSV responses)
    }
    return { status: response.status, body: data, headers: response.headers };
  }

  get(path, headers) {
    return this.request('GET', path, undefined, headers);
  }

  post(path, body, headers) {
    return this.request('POST', path, body, headers);
  }

  patch(path, body, headers) {
    return this.request('PATCH', path, body, headers);
  }
}

async function startTestServer(name, extraEnv = {}) {
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = testDatabaseUri(name);
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-secret';
  process.env.EMAIL_API_KEY = '';
  process.env.EMAIL_FROM = '';
  process.env.FIREBASE_PROJECT_ID = '';
  Object.assign(process.env, extraEnv);

  const mongoose = require('mongoose');
  const connectDB = require('../../server/config/db');
  const app = require('../../server/app');
  const User = require('../../server/models/User');

  await connectDB();
  await Promise.all(mongoose.modelNames().map((model) => mongoose.model(model).init()));

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const users = {};
  for (const [key, user] of Object.entries(USERS)) {
    users[key] = await User.create({ active: true, ...user, passwordHash });
  }

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function loginAs(key) {
    const client = new ApiClient(baseUrl);
    const response = await client.post('/api/auth/login', { email: USERS[key].email, password: PASSWORD });
    if (response.status !== 200) {
      throw new Error(`Login as ${key} failed with ${response.status}`);
    }
    client.user = response.body.user;
    return client;
  }

  async function close() {
    await new Promise((resolve) => server.close(resolve));
    // Close the session store's own MongoDB connection once it has finished starting;
    // leaving it open can crash the test process on Windows when it exits.
    const store = app.locals.sessionStore;
    if (store) {
      await store.collectionP.catch(() => null);
      await store.close().catch(() => null);
    }
    await mongoose.connection.dropDatabase().catch(() => null);
    await mongoose.disconnect();
  }

  return { baseUrl, users, loginAs, anonymous: () => new ApiClient(baseUrl), close, mongoose };
}

function inMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

module.exports = { startTestServer, inMinutes, PASSWORD, USERS };
