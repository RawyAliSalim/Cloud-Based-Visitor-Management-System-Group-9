// Visitor Registration Service (Rawy Ali Salim): validation, returning visitors,
// duplicate prevention and idempotent registration.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, inMinutes } = require('../helpers/testServer');

let ctx;
let frontDesk;
let host1;
let host2;
let counter = 0;

before(async () => {
  ctx = await startTestServer('registration');
  frontDesk = await ctx.loginAs('frontDesk');
  host1 = await ctx.loginAs('host1');
  host2 = await ctx.loginAs('host2');
});

after(async () => {
  await ctx.close();
});

function unique() {
  counter += 1;
  return `${Date.now().toString(36)}${counter}`;
}

function visit(overrides = {}) {
  return {
    fullName: 'Nour Hassan',
    hostId: String(ctx.users.host1._id),
    purpose: 'Interview',
    expectedArrival: inMinutes(15),
    ...overrides
  };
}

describe('input validation', () => {
  test('rejects names with markup, symbols or a leading digit', async () => {
    const res = await frontDesk.post('/api/visits', visit({ fullName: '<script>x</script>' }));
    assert.equal(res.status, 400);
    assert.equal((await frontDesk.post('/api/visits', visit({ fullName: 'john@smith' }))).status, 400);
    assert.equal((await frontDesk.post('/api/visits', visit({ fullName: '123 Visitor' }))).status, 400);
  });

  test('accepts non-English names and trims extra spaces', async () => {
    const res = await frontDesk.post('/api/visits', visit({ fullName: '  محمد   علي  ', email: `${unique()}@ex.com` }));
    assert.equal(res.status, 201);
    assert.equal(res.body.visitorId.fullName, 'محمد علي');
  });

  test('rejects arrival times more than 90 days ahead', async () => {
    const res = await frontDesk.post('/api/visits', visit({ expectedArrival: inMinutes(60 * 24 * 120) }));
    assert.equal(res.status, 400);
  });

  test('rejects non-text values and markup in purpose', async () => {
    assert.equal((await frontDesk.post('/api/visits', visit({ fullName: 42 }))).status, 400);
    assert.equal((await frontDesk.post('/api/visits', visit({ purpose: '<b>x</b>' }))).status, 400);
    assert.equal((await frontDesk.post('/api/visits', visit({ purpose: '   ' }))).status, 400);
  });

  test('empty email and phone are treated as not given', async () => {
    const res = await frontDesk.post('/api/visits', visit({ fullName: 'No Contact', email: '', phone: '', purpose: unique() }));
    assert.equal(res.status, 201);
    assert.equal(res.body.visitorId.email, undefined);
  });

  test('hosts cannot attach registrations to an existing visitor id', async () => {
    const created = await frontDesk.post('/api/visits', visit({ email: `${unique()}@ex.com` }));
    const res = await host1.post('/api/visits', visit({ hostId: undefined, visitorId: created.body.visitorId._id }));
    assert.equal(res.status, 403);
  });
});

describe('returning visitors and duplicate visitor records', () => {
  test('a second registration with the same email reuses the visitor record', async () => {
    const email = `${unique()}@example.com`;
    const first = await frontDesk.post('/api/visits', visit({ fullName: 'Laila Omar', email, expectedArrival: inMinutes(10) }));
    assert.equal(first.status, 201);
    assert.equal(first.body.registration.returning, false);

    const second = await frontDesk.post(
      '/api/visits',
      visit({ fullName: 'laila  omar', email: email.toUpperCase(), company: 'Acme', expectedArrival: inMinutes(60 * 24) })
    );
    assert.equal(second.status, 201);
    assert.equal(second.body.registration.returning, true);
    assert.equal(second.body.registration.matchedBy, 'email');
    assert.equal(second.body.visitorId._id, first.body.visitorId._id);
    // Missing details are filled in, saved values are kept.
    assert.equal(second.body.visitorId.company, 'Acme');
    assert.equal(second.body.visitorId.fullName, 'Laila Omar');
  });

  test('phone numbers match regardless of spaces and dashes', async () => {
    const phone = `+20 10 ${String(Date.now()).slice(-8)}`;
    const first = await frontDesk.post('/api/visits', visit({ fullName: 'Karim Adel', phone }));
    const second = await frontDesk.post(
      '/api/visits',
      visit({ fullName: 'Karim Adel', phone: phone.replace(/ /g, '-'), hostId: String(ctx.users.host2._id) })
    );
    assert.equal(second.status, 201);
    assert.equal(second.body.registration.matchedBy, 'phone');
    assert.equal(second.body.visitorId._id, first.body.visitorId._id);
  });

  test('an email that belongs to a different person is a conflict', async () => {
    const email = `${unique()}@example.com`;
    await frontDesk.post('/api/visits', visit({ fullName: 'Mona Fawzy', email }));
    const res = await host2.post('/api/visits', visit({ fullName: 'Someone Else', email, hostId: undefined }));
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'VISITOR_CONTACT_CONFLICT');
    // The conflict response does not reveal the saved visitor's name.
    assert.equal(JSON.stringify(res.body).includes('Mona'), false);
  });

  test('email of one visitor plus phone of another is a conflict', async () => {
    const email = `${unique()}@example.com`;
    const phone = `+44 7700 ${String(Date.now()).slice(-6)}`;
    await frontDesk.post('/api/visits', visit({ fullName: 'Ali One', email }));
    await frontDesk.post('/api/visits', visit({ fullName: 'Ali One', phone, hostId: String(ctx.users.host2._id) }));
    const res = await frontDesk.post('/api/visits', visit({ fullName: 'Ali One', email, phone, expectedArrival: inMinutes(600) }));
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'VISITOR_CONTACT_CONFLICT');
  });

  test('concurrent registrations of a new visitor create one visitor record', async () => {
    const email = `${unique()}@example.com`;
    const results = await Promise.all(
      [10, 400, 800].map((minutes) =>
        frontDesk.post('/api/visits', visit({ fullName: 'Race Case', email, expectedArrival: inMinutes(minutes) }))
      )
    );
    results.forEach((res) => assert.equal(res.status, 201));
    const ids = new Set(results.map((res) => res.body.visitorId._id));
    assert.equal(ids.size, 1);
  });

  test('editing a visit cannot steal another visitor\'s email', async () => {
    const email = `${unique()}@example.com`;
    await frontDesk.post('/api/visits', visit({ fullName: 'Owner Person', email }));
    const other = await frontDesk.post('/api/visits', visit({ fullName: 'Other Person', email: `${unique()}@ex.com` }));
    const res = await frontDesk.patch(`/api/visits/${other.body._id}`, { email });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'VISITOR_CONTACT_CONFLICT');
  });

  test('visitor lookup shows visit history counts', async () => {
    const email = `${unique()}@example.com`;
    const created = await frontDesk.post('/api/visits', visit({ fullName: 'Lookup Person', email }));
    await frontDesk.post(`/api/visits/${created.body._id}/check-in`);
    await frontDesk.post(`/api/visits/${created.body._id}/check-out`);

    const search = await frontDesk.get(`/api/visitors?search=${encodeURIComponent(email)}`);
    assert.equal(search.status, 200);
    assert.equal(search.body.length, 1);
    assert.equal(search.body[0].visitCount, 1);
    assert.equal(search.body[0].returningVisitor, true);
    assert.equal(search.body[0].emailKey, undefined);

    const profile = await frontDesk.get(`/api/visitors/${search.body[0]._id}`);
    assert.equal(profile.status, 200);
    assert.equal(profile.body.visits.length, 1);
    assert.equal(profile.body.visits[0].status, 'Checked-out');

    assert.equal((await host1.get(`/api/visitors/${search.body[0]._id}`)).status, 403);
  });
});

describe('duplicate visits', () => {
  test('the same visitor cannot be registered twice for the same host at the same time', async () => {
    const email = `${unique()}@example.com`;
    const first = await frontDesk.post('/api/visits', visit({ email }));
    const second = await frontDesk.post('/api/visits', visit({ email, expectedArrival: inMinutes(45) }));
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'DUPLICATE_VISIT');
    assert.equal(second.body.error.details.visitId, first.body._id);
  });

  test('a different host or a later day is allowed', async () => {
    const email = `${unique()}@example.com`;
    await frontDesk.post('/api/visits', visit({ email }));
    const otherHost = await frontDesk.post('/api/visits', visit({ email, hostId: String(ctx.users.host2._id) }));
    assert.equal(otherHost.status, 201);
    const tomorrow = await frontDesk.post('/api/visits', visit({ email, expectedArrival: inMinutes(60 * 24) }));
    assert.equal(tomorrow.status, 201);
  });

  test('a cancelled visit does not block a new registration', async () => {
    const email = `${unique()}@example.com`;
    const first = await frontDesk.post('/api/visits', visit({ email }));
    await frontDesk.post(`/api/visits/${first.body._id}/cancel`);
    const again = await frontDesk.post('/api/visits', visit({ email }));
    assert.equal(again.status, 201);
  });

  test('moving a visit onto another active visit is rejected', async () => {
    const email = `${unique()}@example.com`;
    await frontDesk.post('/api/visits', visit({ email, expectedArrival: inMinutes(30) }));
    const later = await frontDesk.post('/api/visits', visit({ email, expectedArrival: inMinutes(60 * 24) }));
    const res = await frontDesk.patch(`/api/visits/${later.body._id}`, { expectedArrival: inMinutes(40) });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'DUPLICATE_VISIT');
  });
});

describe('idempotent registration', () => {
  test('repeating a request with the same Idempotency-Key returns the same visit', async () => {
    const key = `key-${unique()}`;
    const body = visit({ fullName: 'Double Click', email: `${unique()}@ex.com` });
    const [a, b] = await Promise.all([
      frontDesk.post('/api/visits', body, { 'Idempotency-Key': key }),
      frontDesk.post('/api/visits', body, { 'Idempotency-Key': key })
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 201]);
    assert.equal(a.body._id, b.body._id);
  });

  test('reusing a key for a different registration is rejected', async () => {
    const key = `key-${unique()}`;
    await frontDesk.post('/api/visits', visit({ email: `${unique()}@ex.com` }), { 'Idempotency-Key': key });
    const res = await frontDesk.post('/api/visits', visit({ purpose: 'Something else', email: `${unique()}@ex.com` }), {
      'Idempotency-Key': key
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
  });

  test('malformed keys are rejected', async () => {
    const res = await frontDesk.post('/api/visits', visit(), { 'Idempotency-Key': 'bad key!' });
    assert.equal(res.status, 400);
  });
});

describe('host editing rules', () => {
  test('hosts cannot change contact details', async () => {
    const created = await host1.post('/api/visits', visit({ fullName: 'Host Guest', hostId: undefined, purpose: unique() }));
    const res = await host1.patch(`/api/visits/${created.body._id}`, { email: 'new@example.com' });
    assert.equal(res.status, 403);
  });

  test('hosts cannot rename a visitor that other hosts also receive', async () => {
    const email = `${unique()}@example.com`;
    await frontDesk.post('/api/visits', visit({ fullName: 'Shared Visitor', email, hostId: String(ctx.users.host2._id) }));
    const own = await frontDesk.post('/api/visits', visit({ fullName: 'Shared Visitor', email }));
    const res = await host1.patch(`/api/visits/${own.body._id}`, { fullName: 'Renamed Visitor' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'VISITOR_SHARED');
  });
});
