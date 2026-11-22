// Regression tests for the behaviour that already existed before the TA-feedback work.
// Every member branch must keep these passing.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, inMinutes } = require('../helpers/testServer');

let ctx;
let frontDesk;
let host1;
let host2;

before(async () => {
  ctx = await startTestServer('baseline');
  frontDesk = await ctx.loginAs('frontDesk');
  host1 = await ctx.loginAs('host1');
  host2 = await ctx.loginAs('host2');
});

after(async () => {
  await ctx.close();
});

function newVisit(overrides = {}) {
  return {
    fullName: `Visitor ${Math.random().toString(36).slice(2, 8)}`,
    company: 'Acme',
    hostId: String(ctx.users.host1._id),
    purpose: 'Meeting',
    expectedArrival: inMinutes(10),
    ...overrides
  };
}

describe('authentication and roles', () => {
  test('health check is public', async () => {
    const res = await ctx.anonymous().get('/api/health');
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('x-request-id'));
  });

  test('wrong password returns 401 without revealing which part was wrong', async () => {
    const res = await ctx.anonymous().post('/api/auth/login', { email: 'host1@test.local', password: 'nope-nope' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
  });

  test('inactive accounts cannot log in', async () => {
    await assert.rejects(() => ctx.loginAs('inactiveHost'));
  });

  test('protected routes need a session', async () => {
    const res = await ctx.anonymous().get('/api/visits');
    assert.equal(res.status, 401);
  });

  test('login response never contains the password hash', async () => {
    const res = await ctx.anonymous().post('/api/auth/login', { email: 'admin@test.local', password: 'Test-Password-123' });
    assert.equal(res.status, 200);
    assert.equal(JSON.stringify(res.body).includes('passwordHash'), false);
  });

  test('hosts cannot check visitors in', async () => {
    const created = await frontDesk.post('/api/visits', newVisit());
    const res = await host1.post(`/api/visits/${created.body._id}/check-in`);
    assert.equal(res.status, 403);
  });
});

describe('existing visit workflow', () => {
  test('register, edit, check in, check out', async () => {
    const created = await frontDesk.post('/api/visits', newVisit());
    assert.equal(created.status, 201);
    assert.equal(created.body.status, 'Expected');

    const edited = await frontDesk.patch(`/api/visits/${created.body._id}`, { purpose: 'Interview' });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.purpose, 'Interview');

    const checkedIn = await frontDesk.post(`/api/visits/${created.body._id}/check-in`);
    assert.equal(checkedIn.status, 200);
    assert.equal(checkedIn.body.status, 'Checked-in');
    assert.ok(Array.isArray(checkedIn.body.notifications));

    const editAfter = await frontDesk.patch(`/api/visits/${created.body._id}`, { purpose: 'Late change' });
    assert.equal(editAfter.status, 409);

    const checkedOut = await frontDesk.post(`/api/visits/${created.body._id}/check-out`);
    assert.equal(checkedOut.status, 200);
    assert.equal(checkedOut.body.status, 'Checked-out');

    const again = await frontDesk.post(`/api/visits/${created.body._id}/check-out`);
    assert.equal(again.status, 409);
  });

  test('cancelled visits cannot be checked in', async () => {
    const created = await frontDesk.post('/api/visits', newVisit());
    const cancelled = await frontDesk.post(`/api/visits/${created.body._id}/cancel`);
    assert.equal(cancelled.status, 200);
    const res = await frontDesk.post(`/api/visits/${created.body._id}/check-in`);
    assert.equal(res.status, 409);
  });

  test('validation errors return 400', async () => {
    const missing = await frontDesk.post('/api/visits', newVisit({ purpose: undefined }));
    assert.equal(missing.status, 400);
    const badEmail = await frontDesk.post('/api/visits', newVisit({ email: 'not-an-email' }));
    assert.equal(badEmail.status, 400);
    const past = await frontDesk.post('/api/visits', newVisit({ expectedArrival: inMinutes(-120) }));
    assert.equal(past.status, 400);
    const inactive = await frontDesk.post('/api/visits', newVisit({ hostId: String(ctx.users.inactiveHost._id) }));
    assert.equal(inactive.status, 400);
  });

  test('hosts only see and manage their own visits', async () => {
    const own = await host1.post('/api/visits', newVisit({ hostId: undefined }));
    assert.equal(own.status, 201);
    const forOther = await host1.post('/api/visits', newVisit({ hostId: String(ctx.users.host2._id) }));
    assert.equal(forOther.status, 403);

    const view = await host2.get(`/api/visits/${own.body._id}`);
    assert.equal(view.status, 403);
    const cancel = await host2.post(`/api/visits/${own.body._id}/cancel`);
    assert.equal(cancel.status, 403);

    const list = await host2.get('/api/visits');
    assert.equal(list.status, 200);
    assert.equal(list.body.some((visit) => visit._id === own.body._id), false);
  });

  test('hosts do not receive visitor contact details', async () => {
    const created = await frontDesk.post('/api/visits', newVisit({ email: 'private@example.com' }));
    const view = await host1.get(`/api/visits/${created.body._id}`);
    assert.equal(view.status, 200);
    assert.equal(view.body.visitorId.email, undefined);
  });
});

describe('existing notification behaviour', () => {
  test('check-in creates notifications that only the recipient host can acknowledge', async () => {
    const created = await frontDesk.post('/api/visits', newVisit());
    await frontDesk.post(`/api/visits/${created.body._id}/check-in`);

    const list = await host1.get(`/api/notifications?visitId=${created.body._id}`);
    assert.equal(list.status, 200);
    assert.ok(list.body.length >= 1);
    const notification = list.body[0];

    const wrongHost = await host2.post(`/api/notifications/${notification._id}/acknowledge`);
    assert.equal(wrongHost.status, 403);

    const ack = await host1.post(`/api/notifications/${notification._id}/acknowledge`);
    assert.equal(ack.status, 200);
    assert.ok(ack.body.acknowledgedAt);

    const twice = await host1.post(`/api/notifications/${notification._id}/acknowledge`);
    assert.equal(twice.status, 409);
  });

  test('front desk cannot acknowledge and hosts cannot resend', async () => {
    const created = await frontDesk.post('/api/visits', newVisit());
    await frontDesk.post(`/api/visits/${created.body._id}/check-in`);
    const list = await frontDesk.get(`/api/notifications?visitId=${created.body._id}`);
    const id = list.body[0]._id;

    assert.equal((await frontDesk.post(`/api/notifications/${id}/acknowledge`)).status, 403);
    assert.equal((await host1.post(`/api/notifications/${id}/resend`)).status, 403);
  });
});
