// Security measures: headers, NoSQL-injection blocking, cross-site request blocking,
// login brute-force protection, account revocation and safe error responses.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, inMinutes, PASSWORD, USERS } = require('../helpers/testServer');

let ctx;
let User;
let LoginAttempt;

before(async () => {
  ctx = await startTestServer('security', { CORS_ORIGINS: 'http://localhost:5173' });
  User = ctx.mongoose.model('User');
  LoginAttempt = require('../../server/models/LoginAttempt');
});

after(async () => {
  await ctx.close();
});

let ipCounter = 0;
// Each test uses its own client IP so the per-IP limit of one test does not affect another.
function fromIp() {
  ipCounter += 1;
  return { 'X-Forwarded-For': `10.0.0.${ipCounter}` };
}

function login(email, password, headers = fromIp()) {
  return ctx.anonymous().post('/api/auth/login', { email, password }, headers);
}

describe('security headers', () => {
  test('API responses carry security headers and are not cached', async () => {
    for (const path of ['/api/health', '/api/does-not-exist']) {
      const res = await ctx.anonymous().get(path);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('x-frame-options'), 'DENY');
      assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
      assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.equal(res.headers.get('x-powered-by'), null);
    }
  });

  test('session cookie is HttpOnly and SameSite=Lax', async () => {
    const res = await login(USERS.frontDesk.email, PASSWORD);
    const cookie = res.headers.getSetCookie().find((value) => value.startsWith('vms.sid='));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
  });
});

describe('NoSQL injection', () => {
  test('operator objects in the login body are refused', async () => {
    const res = await ctx.anonymous().post('/api/auth/login', { email: { $ne: null }, password: { $ne: null } }, fromIp());
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_INPUT');
  });

  test('operators nested in other requests are refused', async () => {
    const client = await ctx.loginAs('frontDesk');
    const res = await client.post('/api/visits', {
      fullName: { $gt: '' },
      hostId: String(ctx.users.host1._id),
      purpose: 'x',
      expectedArrival: inMinutes(10)
    });
    assert.equal(res.status, 400);
    const dotted = await client.patch(`/api/visits/${'a'.repeat(24)}`, { 'visitorId.fullName': 'x' });
    assert.equal(dotted.status, 400);
  });
});

describe('cross-site request protection', () => {
  test('a POST from another website is blocked', async () => {
    const client = await ctx.loginAs('frontDesk');
    const res = await client.post('/api/auth/logout', undefined, { Origin: 'https://evil.example' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'CROSS_SITE_REQUEST');
  });

  test('requests from this site or the configured front end are allowed', async () => {
    const own = await ctx.anonymous().post('/api/auth/login', { email: USERS.admin.email, password: PASSWORD }, {
      ...fromIp(),
      Origin: ctx.baseUrl
    });
    assert.equal(own.status, 200);
    const dev = await ctx.anonymous().post('/api/auth/login', { email: USERS.admin.email, password: PASSWORD }, {
      ...fromIp(),
      Origin: 'http://localhost:5173'
    });
    assert.equal(dev.status, 200);
  });
});

describe('login brute-force protection', () => {
  test('5 wrong passwords lock the account for 15 minutes, even for the right password', async () => {
    const headers = fromIp();
    for (let i = 0; i < 5; i += 1) {
      const res = await login(USERS.host2.email, 'wrong-password', headers);
      assert.equal(res.status, 401);
    }
    const locked = await login(USERS.host2.email, PASSWORD, fromIp());
    assert.equal(locked.status, 429);
    assert.equal(locked.body.error.code, 'TOO_MANY_ATTEMPTS');
    const retryAfter = Number(locked.headers.get('retry-after'));
    assert.ok(retryAfter > 800 && retryAfter <= 900);

    // Other accounts are not affected.
    assert.equal((await login(USERS.host1.email, PASSWORD)).status, 200);

    // When the lock expires the right password works and the counter is cleared.
    await LoginAttempt.updateOne({ key: `email:${USERS.host2.email}` }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
    assert.equal((await login(USERS.host2.email, PASSWORD)).status, 200);
    assert.equal(await LoginAttempt.countDocuments({ key: `email:${USERS.host2.email}` }), 0);
  });

  test('one IP trying many accounts is blocked after 20 failures', async () => {
    const headers = fromIp();
    for (let i = 0; i < 20; i += 1) {
      await login(`nobody${i}@test.local`, 'guess', headers);
    }
    const res = await login(USERS.admin.email, PASSWORD, headers);
    assert.equal(res.status, 429);
    assert.equal((await login(USERS.admin.email, PASSWORD)).status, 200, 'other IPs still work');
  });

  test('unknown emails and wrong passwords get the same answer', async () => {
    const unknown = await login('nobody@test.local', 'whatever');
    const wrong = await login(USERS.frontDesk.email, 'whatever');
    assert.equal(unknown.status, 401);
    assert.deepEqual(unknown.body, wrong.body);
  });

  test('over-long passwords are refused before hashing', async () => {
    const res = await login(USERS.frontDesk.email, 'x'.repeat(500));
    assert.equal(res.status, 400);
  });
});

describe('account revocation', () => {
  test('deactivating a user ends their existing session immediately', async () => {
    const extra = await User.create({ name: 'Temp Desk', email: `temp${Date.now()}@test.local`, role: 'front-desk', passwordHash: ctx.users.admin.passwordHash });
    const client = ctx.anonymous();
    assert.equal((await client.post('/api/auth/login', { email: extra.email, password: PASSWORD }, fromIp())).status, 200);
    assert.equal((await client.get('/api/visits')).status, 200);

    await User.updateOne({ _id: extra._id }, { $set: { active: false } });
    const res = await client.get('/api/visits');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'ACCOUNT_DISABLED');
    assert.equal((await client.get('/api/auth/me')).status, 401, 'session was destroyed');
  });

  test('a role change applies on the next request', async () => {
    const extra = await User.create({ name: 'Role Change', email: `role${Date.now()}@test.local`, role: 'front-desk', passwordHash: ctx.users.admin.passwordHash });
    const client = ctx.anonymous();
    await client.post('/api/auth/login', { email: extra.email, password: PASSWORD }, fromIp());
    assert.equal((await client.get('/api/visits/on-site')).status, 200);
    await User.updateOne({ _id: extra._id }, { $set: { role: 'host' } });
    assert.equal((await client.get('/api/visits/on-site')).status, 403);
  });
});

describe('safe error responses', () => {
  test('malformed JSON and server errors do not leak internals', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...fromIp() },
      body: '{"email": '
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message']);
    assert.equal(JSON.stringify(body).includes('at '), false);
  });
});
