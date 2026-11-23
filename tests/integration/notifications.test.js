// Host Notification Service (Mohamed Haytham): delivery status, automatic retries with
// backoff, duplicate prevention, acknowledgement and manual resend rules.
// A local fake email provider stands in for Brevo so failures can be produced on demand.
const http = require('http');
const { test, before, after, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, inMinutes } = require('../helpers/testServer');

const fakeEmail = {
  queue: [],
  received: 0,
  server: null,
  url: null
};

let ctx;
let frontDesk;
let host1;
let host2;
let Notification;
let Visit;
let notificationService;

before(async () => {
  fakeEmail.server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      fakeEmail.received += 1;
      fakeEmail.lastBody = raw;
      const status = fakeEmail.queue.length ? fakeEmail.queue.shift() : 201;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ messageId: 'fake' }));
    });
  });
  await new Promise((resolve) => fakeEmail.server.listen(0, '127.0.0.1', resolve));
  fakeEmail.url = `http://127.0.0.1:${fakeEmail.server.address().port}/v3/smtp/email`;

  ctx = await startTestServer('notifications', {
    EMAIL_API_KEY: 'test-key-not-real',
    EMAIL_FROM: 'vms@test.local',
    EMAIL_API_URL: fakeEmail.url,
    NOTIFICATION_INLINE_RETRY_MS: '10',
    NOTIFICATION_RESEND_COOLDOWN_SECONDS: '0',
    NOTIFICATION_MAX_ATTEMPTS: '5',
    CRON_SECRET: 'test-cron-secret-value',
    APP_URL: 'https://vms.example.test/'
  });
  frontDesk = await ctx.loginAs('frontDesk');
  host1 = await ctx.loginAs('host1');
  host2 = await ctx.loginAs('host2');
  Notification = ctx.mongoose.model('Notification');
  Visit = ctx.mongoose.model('Visit');
  notificationService = require('../../server/services/notification.service');
});

after(async () => {
  await ctx.close();
  await new Promise((resolve) => fakeEmail.server.close(resolve));
});

beforeEach(() => {
  fakeEmail.queue = [];
});

let counter = 0;
async function checkedInVisit(hostKey = 'host1') {
  counter += 1;
  const created = await frontDesk.post('/api/visits', {
    fullName: `Notify Guest ${counter}`,
    hostId: String(ctx.users[hostKey]._id),
    purpose: 'Meeting',
    expectedArrival: inMinutes(5)
  });
  assert.equal(created.status, 201);
  const checkedIn = await frontDesk.post(`/api/visits/${created.body._id}/check-in`);
  assert.equal(checkedIn.status, 200);
  return checkedIn.body;
}

async function notificationsFor(visitId) {
  const all = await Notification.find({ visitId }).sort({ createdAt: 1 }).lean();
  return { all, email: all.find((n) => n.channel === 'email' && !n.resendOf), push: all.find((n) => n.channel === 'push') };
}

async function makeDue(id) {
  await Notification.updateOne({ _id: id }, { $set: { nextRetryAt: new Date(Date.now() - 1000) } });
}

describe('delivery status tracking', () => {
  test('successful email is Sent on the first attempt; push without setup fails permanently', async () => {
    const visit = await checkedInVisit();
    const { email, push } = await notificationsFor(visit._id);
    assert.equal(email.status, 'Sent');
    assert.equal(email.attempts, 1);
    assert.ok(email.sentAt);
    assert.equal(email.attemptLog.length, 1);

    assert.equal(push.status, 'Failed');
    assert.equal(push.error, 'PUSH_NOT_CONFIGURED');
    assert.equal(push.attempts, 1, 'permanent errors are not retried');
    assert.equal(push.nextRetryAt, null);
  });

  test('a temporary provider error is retried straight away and recorded', async () => {
    fakeEmail.queue = [500];
    const visit = await checkedInVisit();
    const { email } = await notificationsFor(visit._id);
    assert.equal(email.status, 'Sent');
    assert.equal(email.attempts, 2);
    assert.deepEqual(email.attemptLog.map((a) => a.status), ['Failed', 'Sent']);
    assert.equal(email.attemptLog[0].error, 'EMAIL_PROVIDER_ERROR_500');
  });

  test('a rejected request (4xx) fails without retrying', async () => {
    fakeEmail.queue = [400];
    const visit = await checkedInVisit();
    const { email } = await notificationsFor(visit._id);
    assert.equal(email.status, 'Failed');
    assert.equal(email.attempts, 1);
  });

  test('check-in response reports each channel status', async () => {
    const visit = await checkedInVisit();
    const channels = Object.fromEntries(visit.notifications.map((n) => [n.channel, n.status]));
    assert.deepEqual(channels, { email: 'Sent', push: 'Failed' });
  });
});

describe('automatic retries', () => {
  test('persistent outages back off, retry on schedule and stop after the attempt limit', async () => {
    fakeEmail.queue = [503, 503];
    const visit = await checkedInVisit();
    let { email } = await notificationsFor(visit._id);
    assert.equal(email.status, 'Retrying');
    assert.equal(email.attempts, 2);
    const delay = new Date(email.nextRetryAt).getTime() - Date.now();
    assert.ok(delay > 40 * 1000 && delay < 80 * 1000, `second backoff should be about 60 s, got ${delay}`);

    // Not due yet: nothing happens.
    const early = await frontDesk.post('/api/notifications/retry-due');
    assert.equal(early.status, 200);
    assert.equal((await Notification.findById(email._id)).attempts, 2);

    for (let attempt = 3; attempt <= 5; attempt += 1) {
      fakeEmail.queue = [503];
      await makeDue(email._id);
      const res = await frontDesk.post('/api/notifications/retry-due');
      assert.equal(res.status, 200);
      email = await Notification.findById(email._id).lean();
      assert.equal(email.attempts, attempt);
    }
    assert.equal(email.status, 'Failed', 'gives up after NOTIFICATION_MAX_ATTEMPTS');
    assert.equal(email.nextRetryAt, null);
    assert.equal(email.attemptLog.length, 5);
  });

  test('a due retry that now succeeds becomes Sent', async () => {
    fakeEmail.queue = [503, 503];
    const visit = await checkedInVisit();
    const { email } = await notificationsFor(visit._id);
    await makeDue(email._id);
    // Opening the notification list also processes due retries (serverless-friendly).
    await frontDesk.get('/api/notifications');
    const after = await Notification.findById(email._id).lean();
    assert.equal(after.status, 'Sent');
    assert.equal(after.attempts, 3);
  });

  test('retries stop once the visitor has left', async () => {
    fakeEmail.queue = [503, 503];
    const visit = await checkedInVisit();
    const { email } = await notificationsFor(visit._id);
    await frontDesk.post(`/api/visits/${visit._id}/check-out`);
    await makeDue(email._id);
    const before = fakeEmail.received;
    await frontDesk.post('/api/notifications/retry-due');
    const after = await Notification.findById(email._id).lean();
    assert.equal(after.status, 'Cancelled');
    assert.equal(after.error, 'VISIT_NO_LONGER_ON_SITE');
    assert.equal(fakeEmail.received, before, 'no email was sent');
  });

  test('two workers never deliver the same retry twice', async () => {
    fakeEmail.queue = [503, 503];
    const visit = await checkedInVisit();
    const { email } = await notificationsFor(visit._id);
    await makeDue(email._id);
    const before = fakeEmail.received;
    const results = await Promise.all([
      notificationService.processDueRetries({ limit: 5 }),
      notificationService.processDueRetries({ limit: 5 }),
      notificationService.processDueRetries({ limit: 5 })
    ]);
    assert.equal(results.reduce((sum, r) => sum + r.processed, 0), 1);
    assert.equal(fakeEmail.received - before, 1);
  });

  test('retry-due needs staff or the cron secret', async () => {
    assert.equal((await ctx.anonymous().post('/api/notifications/retry-due')).status, 401);
    assert.equal((await host1.post('/api/notifications/retry-due')).status, 403);
    const wrong = await ctx.anonymous().post('/api/notifications/retry-due', undefined, { Authorization: 'Bearer nope' });
    assert.equal(wrong.status, 401);
    const cron = await ctx.anonymous().post('/api/notifications/retry-due', undefined, {
      Authorization: 'Bearer test-cron-secret-value'
    });
    assert.equal(cron.status, 200);
    assert.equal(typeof cron.body.processed, 'number');
  });

  test('error classification and backoff limits', () => {
    assert.equal(notificationService.isRetryable('EMAIL_PROVIDER_ERROR_503'), true);
    assert.equal(notificationService.isRetryable('EMAIL_PROVIDER_ERROR_429'), true);
    assert.equal(notificationService.isRetryable('EMAIL_PROVIDER_ERROR_401'), false);
    assert.equal(notificationService.isRetryable('EMAIL_TIMEOUT'), true);
    assert.equal(notificationService.isRetryable('NO_PUSH_TOKEN'), false);
    for (let attempts = 1; attempts <= 12; attempts += 1) {
      assert.ok(notificationService.retryDelayMs(attempts) <= 900 * 1000 * 1.2);
    }
  });
});

describe('arrival email content', () => {
  test('the email names the visitor, goes to the host and links to the notifications page', async () => {
    await checkedInVisit();
    const sent = JSON.parse(fakeEmail.lastBody);
    assert.equal(sent.to[0].email, 'host1@test.local');
    assert.equal(sent.sender.email, 'vms@test.local');
    assert.match(sent.subject, /^Notify Guest \d+ has arrived$/);
    assert.ok(sent.htmlContent.includes('href="https://vms.example.test/notifications"'));
    assert.ok(sent.textContent.includes('https://vms.example.test/notifications'));
  });
});

describe('duplicate prevention', () => {
  test('notifying the same arrival twice does not create or send more notifications', async () => {
    const visit = await checkedInVisit();
    const before = fakeEmail.received;
    const stored = await Visit.findById(visit._id);
    const again = await notificationService.sendArrivalNotification(stored);
    assert.equal(again.length, 2);
    const { all } = await notificationsFor(visit._id);
    assert.equal(all.length, 2);
    assert.equal(fakeEmail.received, before);
  });
});

describe('acknowledgement', () => {
  test('acknowledging one channel acknowledges the visit and stops pending retries', async () => {
    fakeEmail.queue = [503, 503];
    const visit = await checkedInVisit();
    const { email, push } = await notificationsFor(visit._id);
    assert.equal(email.status, 'Retrying');

    const ack = await host1.post(`/api/notifications/${push._id}/acknowledge`);
    assert.equal(ack.status, 200);
    assert.equal(ack.body.acknowledgedCount, 2);
    assert.equal(ack.body.stoppedRetries, 1);

    const afterEmail = await Notification.findById(email._id).lean();
    assert.ok(afterEmail.acknowledgedAt);
    assert.equal(afterEmail.status, 'Cancelled');
    assert.equal(afterEmail.error, 'ALREADY_ACKNOWLEDGED');

    const second = await host1.post(`/api/notifications/${email._id}/acknowledge`);
    assert.equal(second.status, 409);
  });

  test('simultaneous acknowledgements: one wins', async () => {
    const visit = await checkedInVisit();
    const { email, push } = await notificationsFor(visit._id);
    const results = await Promise.all([
      host1.post(`/api/notifications/${email._id}/acknowledge`),
      host1.post(`/api/notifications/${push._id}/acknowledge`)
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  });

  test('cannot acknowledge after the visitor has left, or another host\'s notification', async () => {
    const visit = await checkedInVisit();
    const { email } = await notificationsFor(visit._id);
    assert.equal((await host2.post(`/api/notifications/${email._id}/acknowledge`)).status, 403);
    await frontDesk.post(`/api/visits/${visit._id}/check-out`);
    const late = await host1.post(`/api/notifications/${email._id}/acknowledge`);
    assert.equal(late.status, 409);
    assert.equal(late.body.error.code, 'VISIT_NOT_ON_SITE');
  });
});

describe('manual resend', () => {
  test('a failed notification can be resent once; the resend is tracked separately', async () => {
    fakeEmail.queue = [400];
    const visit = await checkedInVisit();
    const { email } = await notificationsFor(visit._id);
    assert.equal(email.status, 'Failed');

    const resent = await frontDesk.post(`/api/notifications/${email._id}/resend`);
    assert.equal(resent.status, 201);
    assert.equal(resent.body.status, 'Sent');
    assert.equal(resent.body.resendOf, String(email._id));

    const again = await frontDesk.post(`/api/notifications/${email._id}/resend`);
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'NOTIFICATION_ALREADY_RESENT');
  });

  test('simultaneous resend clicks create one new attempt', async () => {
    fakeEmail.queue = [400];
    const visit = await checkedInVisit();
    const { email } = await notificationsFor(visit._id);
    const results = await Promise.all([1, 2, 3].map(() => frontDesk.post(`/api/notifications/${email._id}/resend`)));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    const resends = await Notification.countDocuments({ resendOf: email._id });
    assert.equal(resends, 1);
  });

  test('resend is refused when it would be pointless', async () => {
    const visit = await checkedInVisit();
    const { email, push } = await notificationsFor(visit._id);
    const sent = await frontDesk.post(`/api/notifications/${email._id}/resend`);
    assert.equal(sent.status, 409);
    assert.equal(sent.body.error.code, 'NOTIFICATION_NOT_FAILED');

    await host1.post(`/api/notifications/${email._id}/acknowledge`);
    const acknowledged = await frontDesk.post(`/api/notifications/${push._id}/resend`);
    assert.equal(acknowledged.status, 409);
    assert.equal(acknowledged.body.error.code, 'NOTIFICATION_ALREADY_ACKNOWLEDGED');

    const other = await checkedInVisit();
    const otherPush = (await notificationsFor(other._id)).push;
    await frontDesk.post(`/api/visits/${other._id}/check-out`);
    const left = await frontDesk.post(`/api/notifications/${otherPush._id}/resend`);
    assert.equal(left.status, 409);
    assert.equal(left.body.error.code, 'VISIT_NOT_ON_SITE');
  });

  test('resending too quickly is rate limited', async () => {
    process.env.NOTIFICATION_RESEND_COOLDOWN_SECONDS = '60';
    try {
      const visit = await checkedInVisit();
      const { push } = await notificationsFor(visit._id);
      const res = await frontDesk.post(`/api/notifications/${push._id}/resend`);
      assert.equal(res.status, 429);
      assert.ok(Number(res.headers.get('retry-after')) > 0);
    } finally {
      process.env.NOTIFICATION_RESEND_COOLDOWN_SECONDS = '0';
    }
  });
});

describe('summary for the front desk', () => {
  test('shows delivery rates and hosts who have not responded', async () => {
    const visit = await checkedInVisit('host2');
    await Notification.collection.updateMany(
      { visitId: new ctx.mongoose.Types.ObjectId(visit._id) },
      { $set: { createdAt: new Date(Date.now() - 20 * 60 * 1000) } }
    );

    const res = await frontDesk.get('/api/notifications/summary');
    assert.equal(res.status, 200);
    assert.ok(res.body.counts.Sent >= 1);
    const email = res.body.channels.find((c) => c.channel === 'email');
    assert.ok(email.deliveryRate > 0 && email.deliveryRate <= 1);
    assert.ok(res.body.awaitingAcknowledgement.some((item) => item.visitId === visit._id));
    assert.ok(res.body.acknowledgement.acknowledgedVisits >= 1);

    assert.equal((await host1.get('/api/notifications/summary')).status, 403);
    assert.equal((await frontDesk.get('/api/notifications/summary?hours=0')).status, 400);
  });

  test('status filter accepts the new statuses', async () => {
    assert.equal((await frontDesk.get('/api/notifications?status=Retrying')).status, 200);
    assert.equal((await frontDesk.get('/api/notifications?status=Bogus')).status, 400);
  });
});
