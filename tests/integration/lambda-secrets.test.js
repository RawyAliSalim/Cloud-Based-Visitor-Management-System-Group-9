// Lambda start-up: secrets come from Secrets Manager (server/lambda/init.js), not from env vars.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const init = require('../../server/lambda/init');

const saved = {};
const KEYS = ['VMS_SECRET_ID', 'MONGODB_URI', 'SESSION_SECRET', 'EMAIL_API_KEY', 'NODE_ENV'];

beforeEach(() => {
  KEYS.forEach((key) => {
    saved[key] = process.env[key];
    delete process.env[key];
  });
  init.resetForTests();
});

afterEach(() => {
  KEYS.forEach((key) => {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  });
});

test('without VMS_SECRET_ID nothing is loaded (Vercel, Docker, tests)', async () => {
  let called = false;
  await init.beforeStart({ fetch: async () => { called = true; return {}; } });
  assert.equal(called, false);
});

test('the secret is read once per container and its values are applied', async () => {
  process.env.VMS_SECRET_ID = 'vms/floci/app-config';
  let calls = 0;
  const fetch = async (id) => {
    calls += 1;
    assert.equal(id, 'vms/floci/app-config');
    return { MONGODB_URI: 'mongodb://db/vms', SESSION_SECRET: 's3cret', EMAIL_API_KEY: 'key' };
  };
  await init.beforeStart({ fetch });
  await init.beforeStart({ fetch });
  assert.equal(calls, 1);
  assert.equal(process.env.MONGODB_URI, 'mongodb://db/vms');
  assert.equal(process.env.EMAIL_API_KEY, 'key');
});

test('a secret cannot change other settings of the function', async () => {
  process.env.VMS_SECRET_ID = 'x';
  process.env.NODE_ENV = 'production';
  await init.beforeStart({ fetch: async () => ({ MONGODB_URI: 'mongodb://db/vms', SESSION_SECRET: 's', NODE_ENV: 'development' }) });
  assert.equal(process.env.NODE_ENV, 'production');
});

test('a secret without the database string fails clearly and is retried next time', async () => {
  process.env.VMS_SECRET_ID = 'x';
  await assert.rejects(() => init.beforeStart({ fetch: async () => ({ SESSION_SECRET: 's' }) }), /must contain MONGODB_URI/);
  await init.beforeStart({ fetch: async () => ({ MONGODB_URI: 'mongodb://db/vms', SESSION_SECRET: 's' }) });
  assert.equal(process.env.MONGODB_URI, 'mongodb://db/vms');
});
