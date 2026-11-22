// Check-in/Check-out and Visitor Log Service (Mostafa Raafat Mohamed):
// state transitions, check-in rules, visit history and activity reports.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, inMinutes } = require('../helpers/testServer');

let ctx;
let frontDesk;
let admin;
let host1;
let Visit;
let User;

before(async () => {
  ctx = await startTestServer('checkin');
  frontDesk = await ctx.loginAs('frontDesk');
  admin = await ctx.loginAs('admin');
  host1 = await ctx.loginAs('host1');
  Visit = ctx.mongoose.model('Visit');
  User = ctx.mongoose.model('User');
});

after(async () => {
  await ctx.close();
});

let counter = 0;
async function register(overrides = {}) {
  counter += 1;
  const res = await frontDesk.post('/api/visits', {
    fullName: `Guest ${String.fromCharCode(65 + (counter % 26))}${counter}`,
    email: `guest${counter}.${Date.now()}@example.com`,
    hostId: String(ctx.users.host1._id),
    purpose: 'Meeting',
    expectedArrival: inMinutes(10),
    ...overrides
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

// Moves a visit's expected time directly in the database (registration does not allow past times).
async function setExpected(visitId, minutesFromNow) {
  await Visit.updateOne({ _id: visitId }, { $set: { expectedArrival: new Date(Date.now() + minutesFromNow * 60000) } });
}

describe('check-in rules', () => {
  test('cannot check in long before the expected arrival', async () => {
    const visit = await register({ expectedArrival: inMinutes(60 * 5) });
    const res = await frontDesk.post(`/api/visits/${visit._id}/check-in`);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'CHECK_IN_TOO_EARLY');
    assert.ok(res.body.error.details.opensAt);
  });

  test('cannot check in a visit whose time has long passed', async () => {
    const visit = await register();
    await setExpected(visit._id, -60 * 13);
    const res = await frontDesk.post(`/api/visits/${visit._id}/check-in`);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'VISIT_EXPIRED');
  });

  test('a visitor slightly late is still allowed', async () => {
    const visit = await register();
    await setExpected(visit._id, -90);
    const res = await frontDesk.post(`/api/visits/${visit._id}/check-in`);
    assert.equal(res.status, 200);
  });

  test('cannot check in when the host was deactivated', async () => {
    const host = await User.create({ name: 'Leaving Host', email: `leaving${Date.now()}@test.local`, role: 'host', passwordHash: 'x' });
    const visit = await register({ hostId: String(host._id) });
    await User.updateOne({ _id: host._id }, { $set: { active: false } });
    const res = await frontDesk.post(`/api/visits/${visit._id}/check-in`);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'HOST_UNAVAILABLE');
  });

  test('the same visitor cannot be on site twice', async () => {
    const first = await register();
    const second = await register({
      visitorId: first.visitorId._id,
      fullName: undefined,
      email: undefined,
      hostId: String(ctx.users.host2._id)
    });
    assert.equal(second.visitorId._id, first.visitorId._id);

    assert.equal((await frontDesk.post(`/api/visits/${first._id}/check-in`)).status, 200);
    const res = await frontDesk.post(`/api/visits/${second._id}/check-in`);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'VISITOR_ALREADY_ON_SITE');
    assert.equal(res.body.error.details.visitId, first._id);

    await frontDesk.post(`/api/visits/${first._id}/check-out`);
    assert.equal((await frontDesk.post(`/api/visits/${second._id}/check-in`)).status, 200);
  });

  test('concurrent check-ins: exactly one succeeds and one set of notifications is sent', async () => {
    const visit = await register();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => frontDesk.post(`/api/visits/${visit._id}/check-in`))
    );
    const ok = results.filter((res) => res.status === 200);
    const refused = results.filter((res) => res.status === 409);
    assert.equal(ok.length, 1);
    assert.equal(refused.length, 4);

    const stored = await Visit.findById(visit._id).lean();
    assert.equal(stored.statusHistory.filter((entry) => entry.to === 'Checked-in').length, 1);

    const notifications = await frontDesk.get(`/api/notifications?visitId=${visit._id}`);
    assert.equal(notifications.body.length, 2);
  });

  test('clear messages for invalid transitions', async () => {
    const visit = await register();
    assert.equal((await frontDesk.post(`/api/visits/${visit._id}/check-out`)).body.error.code, 'VISIT_NOT_CHECKED_IN');
    await frontDesk.post(`/api/visits/${visit._id}/check-in`);
    const again = await frontDesk.post(`/api/visits/${visit._id}/check-in`);
    assert.equal(again.status, 409);
    assert.match(again.body.error.message, /already checked in/);
    await frontDesk.post(`/api/visits/${visit._id}/check-out`);
    const cancel = await frontDesk.post(`/api/visits/${visit._id}/cancel`);
    assert.equal(cancel.status, 409);
  });

  test('unknown visits return 404 and bad ids 400', async () => {
    assert.equal((await frontDesk.post('/api/visits/64b7f0c2a1b2c3d4e5f60718/check-in')).status, 404);
    assert.equal((await frontDesk.post('/api/visits/not-an-id/check-in')).status, 400);
  });
});

describe('visit history', () => {
  test('every status change is recorded with who made it', async () => {
    const visit = await register();
    await frontDesk.post(`/api/visits/${visit._id}/check-in`);
    const out = await admin.post(`/api/visits/${visit._id}/check-out`);
    assert.equal(out.status, 200);
    assert.ok(out.body.durationMinutes >= 0);
    assert.equal(out.body.checkedInBy.name, 'Test Front Desk');
    assert.equal(out.body.checkedOutBy.name, 'Test Admin');

    const history = out.body.statusHistory.map((entry) => [entry.from, entry.to, entry.by && entry.by.name]);
    assert.deepEqual(history, [
      [null, 'Expected', 'Test Front Desk'],
      ['Expected', 'Checked-in', 'Test Front Desk'],
      ['Checked-in', 'Checked-out', 'Test Admin']
    ]);
  });

  test('cancellation is recorded in the history', async () => {
    const visit = await register();
    const res = await frontDesk.post(`/api/visits/${visit._id}/cancel`);
    assert.equal(res.status, 200);
    const stored = await Visit.findById(visit._id).lean();
    assert.deepEqual(stored.statusHistory.map((entry) => entry.to), ['Expected', 'Cancelled']);
  });

  test('the service refuses transitions that are not in the state machine', async () => {
    const visitService = require('../../server/services/visit.service');
    const visit = await register();
    await assert.rejects(() => visitService.changeStatus(visit._id, 'Cancelled', { status: 'Checked-in' }));
    assert.equal(visitService.isValidTransition('Checked-out', 'Checked-in'), false);
  });
});

describe('real-time on-site board and visitor log', () => {
  test('on-site list shows time on site and flags overstays', async () => {
    const visit = await register();
    await frontDesk.post(`/api/visits/${visit._id}/check-in`);
    await Visit.updateOne({ _id: visit._id }, { $set: { checkInTime: new Date(Date.now() - 9 * 60 * 60 * 1000) } });

    const res = await frontDesk.get('/api/visits/on-site');
    assert.equal(res.status, 200);
    const row = res.body.find((item) => item._id === visit._id);
    assert.ok(row.durationMinutes >= 539);
    assert.equal(row.overstay, true);
    assert.equal(row.statusHistory, undefined);
  });

  test('log can be filtered by check-in date', async () => {
    const visit = await register();
    await frontDesk.post(`/api/visits/${visit._id}/check-in`);
    const from = new Date(Date.now() - 60000).toISOString();
    const res = await frontDesk.get(`/api/visits?dateField=checkIn&from=${encodeURIComponent(from)}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.some((item) => item._id === visit._id));
    assert.ok(res.body.every((item) => item.checkInTime));
    assert.equal((await frontDesk.get('/api/visits?dateField=nope')).status, 400);
  });
});

describe('activity reports', () => {
  test('report summarises visits, durations, hosts and overstays', async () => {
    const res = await frontDesk.get('/api/visits/reports/activity');
    assert.equal(res.status, 200);
    const report = res.body;
    assert.ok(report.totals.registered >= 5);
    assert.ok(report.totals.checkedOut >= 1);
    assert.ok(report.totals.cancelled >= 1);
    assert.ok(report.visitLength.completedVisits >= 1);
    assert.ok(report.byHost.some((row) => row.name === 'Host One'));
    assert.ok(report.byDay.length >= 1);
    assert.ok(report.peakHours.length >= 1);
    assert.ok(report.overstays.length >= 1);
    assert.ok(report.rates.attendanceRate > 0);
  });

  test('report validates its parameters and is staff-only', async () => {
    assert.equal((await frontDesk.get('/api/visits/reports/activity?from=2020-01-01&to=2021-01-01')).status, 400);
    assert.equal((await frontDesk.get('/api/visits/reports/activity?tz=Mars/Olympus')).status, 400);
    assert.equal((await frontDesk.get('/api/visits/reports/activity?hostId=abc')).status, 400);
    assert.equal((await frontDesk.get('/api/visits/reports/activity?tz=Africa/Cairo')).status, 200);
    assert.equal((await host1.get('/api/visits/reports/activity')).status, 403);
  });

  test('CSV export is escaped against formula injection', async () => {
    await register({ fullName: 'Formula Person', purpose: '=HYPERLINK("http://evil")' });
    const res = await frontDesk.get('/api/visits/reports/export?from=' + encodeURIComponent(inMinutes(-60 * 24)) + '&to=' + encodeURIComponent(inMinutes(60 * 24)));
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /attachment/);
    const lines = res.body.split('\r\n');
    assert.match(lines[0], /^Visitor,Company,Host/);
    const row = lines.find((line) => line.startsWith('Formula Person'));
    assert.ok(row.includes(`"'=HYPERLINK(""http://evil"")"`));
  });
});
