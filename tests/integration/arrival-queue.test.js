// Host Notification Service on floci: check-in -> SQS queue -> notifications Lambda.
// The SQS client is replaced by a fake sender here; the real queue is tested on floci.
const { test, before, after, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, inMinutes } = require('../helpers/testServer');

let ctx;
let frontDesk;
let Notification;
let arrivalQueue;
let events;
let originalSend;
const sent = [];

before(async () => {
  ctx = await startTestServer('arrival-queue');
  frontDesk = await ctx.loginAs('frontDesk');
  Notification = ctx.mongoose.model('Notification');
  arrivalQueue = require('../../server/services/arrivalQueue.service');
  events = require('../../server/lambda/events');
  originalSend = arrivalQueue.sendArrival;
});

after(async () => {
  arrivalQueue.sendArrival = originalSend;
  delete process.env.ARRIVALS_QUEUE_URL;
  await ctx.close();
});

afterEach(() => {
  arrivalQueue.sendArrival = originalSend;
  delete process.env.ARRIVALS_QUEUE_URL;
  sent.length = 0;
});

let counter = 0;
async function checkIn() {
  counter += 1;
  const created = await frontDesk.post('/api/visits', {
    fullName: `Queue Guest ${counter}`,
    hostId: String(ctx.users.host1._id),
    purpose: 'Meeting',
    expectedArrival: inMinutes(5)
  });
  assert.equal(created.status, 201);
  return frontDesk.post(`/api/visits/${created.body._id}/check-in`);
}

function sqsEvent(message, id = 'm-1') {
  return { Records: [{ eventSource: 'aws:sqs', messageId: id, body: JSON.stringify(message), attributes: { ApproximateReceiveCount: '1' } }] };
}

describe('check-in with an arrivals queue', () => {
  test('check-in only enqueues the arrival and answers at once', async () => {
    process.env.ARRIVALS_QUEUE_URL = 'http://floci:4566/000000000000/vms-arrivals';
    arrivalQueue.sendArrival = async (visit) => {
      sent.push({ visitId: String(visit._id), hostId: String(visit.hostId) });
      return 'message-1';
    };
    const res = await checkIn();
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'Checked-in');
    assert.deepEqual(res.body.notifications, [
      { channel: 'email', status: 'Queued' },
      { channel: 'push', status: 'Queued' }
    ]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].visitId, res.body._id);
    assert.equal(await Notification.countDocuments({ visitId: res.body._id }), 0, 'nothing delivered yet');
  });

  test('if the queue cannot be reached, the host is notified directly', async () => {
    process.env.ARRIVALS_QUEUE_URL = 'http://floci:4566/000000000000/vms-arrivals';
    arrivalQueue.sendArrival = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    const res = await checkIn();
    assert.equal(res.status, 200);
    assert.equal(res.body.notifications.length, 2);
    assert.ok(res.body.notifications.every((item) => item.status !== 'Queued'));
    assert.equal(await Notification.countDocuments({ visitId: res.body._id }), 2);
  });
});

describe('notifications function triggered by the queue', () => {
  test('an arrival message creates the notifications once, even if delivered twice', async () => {
    process.env.ARRIVALS_QUEUE_URL = 'http://floci:4566/000000000000/vms-arrivals';
    arrivalQueue.sendArrival = async () => 'message-2';
    const res = await checkIn();
    const message = { type: 'visitor-arrival', visitId: res.body._id, hostId: String(ctx.users.host1._id) };

    const first = await events.handle(sqsEvent(message));
    assert.equal(first.processed, 1);
    assert.deepEqual(first.results[0].notified.map((n) => n.split(':')[0]).sort(), ['email', 'push']);

    await events.handle(sqsEvent(message, 'm-2')); // SQS may deliver a message more than once
    assert.equal(await Notification.countDocuments({ visitId: res.body._id }), 2);
  });

  test('arrivals for visitors who already left are skipped', async () => {
    arrivalQueue.sendArrival = async () => 'message-3';
    process.env.ARRIVALS_QUEUE_URL = 'x';
    const res = await checkIn();
    await frontDesk.post(`/api/visits/${res.body._id}/check-out`);
    const result = await events.handle(sqsEvent({ type: 'visitor-arrival', visitId: res.body._id }));
    assert.equal(result.results[0].skipped, 'VISIT_NOT_ON_SITE');
    assert.equal(await Notification.countDocuments({ visitId: res.body._id }), 0);
  });

  test('malformed messages are dropped instead of retried forever', async () => {
    const bad = { Records: [{ eventSource: 'aws:sqs', messageId: 'bad', body: 'not json' }] };
    const result = await events.handle(bad);
    assert.equal(result.results[0].skipped, 'BAD_MESSAGE');
  });

  test('the scheduler event runs due retries', async () => {
    const summary = await events.handle({ action: 'retry-due' });
    assert.equal(typeof summary.processed, 'number');
  });

  test('unknown events are ignored', async () => {
    assert.deepEqual(await events.handle({ hello: 'world' }), { ignored: true });
  });
});
