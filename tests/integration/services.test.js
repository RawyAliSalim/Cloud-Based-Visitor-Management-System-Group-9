// Each Lambda on floci runs only its own service's routes (createApp({ services })).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { startTestServer } = require('../helpers/testServer');

let ctx;
const servers = [];
const apps = [];

before(async () => {
  ctx = await startTestServer('services');
});

after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  // Each extra app has its own session-store connection. Wait until each store has finished
  // starting (TTL index created, connect-mongo's collectionP), then close it; closing earlier
  // interrupts that start-up work and crashes the test process on Windows.
  await Promise.all(
    apps.map(async (app) => {
      await app.locals.sessionStore.collectionP.catch(() => null);
      await app.locals.sessionStore.close();
    })
  );
  await ctx.close();
});

async function serve(services) {
  const { createApp } = require('../../server/app');
  const app = createApp({ services });
  apps.push(app);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

test('a single-service app only answers its own routes', async () => {
  const checkin = await serve(['checkin']);
  const health = await (await fetch(`${checkin}/api/health`)).json();
  assert.deepEqual(health.services, ['checkin']);
  assert.equal((await fetch(`${checkin}/api/visits`)).status, 401, 'own route exists (needs a session)');
  assert.equal((await fetch(`${checkin}/api/notifications`)).status, 404, 'other service is not served');
  assert.equal((await fetch(`${checkin}/api/auth/me`)).status, 404, 'registration/auth is not served');
});

test('the notifications app does not expose visit routes', async () => {
  const notifications = await serve(['notifications']);
  assert.equal((await fetch(`${notifications}/api/notifications`)).status, 401);
  assert.equal((await fetch(`${notifications}/api/visits`)).status, 404);
});

test('unknown service names are rejected at start-up', () => {
  const { createApp } = require('../../server/app');
  assert.throws(() => createApp({ services: ['billing'] }), /Unknown service/);
});
