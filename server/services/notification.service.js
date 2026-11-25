const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');
const Visit = require('../models/Visit');
const Visitor = require('../models/Visitor');
const { sendEmail, isEmailConfigured } = require('./email.service');
const { sendPush } = require('./push.service');
const { isFirebaseConfigured } = require('../config/firebase');
const logger = require('../utils/logger');
const arrivalQueue = require('./arrivalQueue.service');

const CHANNELS = ['email', 'push'];
const LIST_LIMIT = 200;
const LEASE_MS = 60 * 1000;
const ATTEMPT_LOG_LIMIT = 20;

// Errors that will not go away by trying again: configuration problems, missing
// addresses or tokens, and provider 4xx responses other than 429 (rate limited).
const PERMANENT_ERRORS = new Set([
  'EMAIL_NOT_CONFIGURED',
  'HOST_EMAIL_MISSING',
  'PUSH_NOT_CONFIGURED',
  'NO_PUSH_TOKEN',
  'HOST_NOT_FOUND',
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument'
]);

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function settings() {
  return {
    maxAttempts: Math.max(1, numberFromEnv('NOTIFICATION_MAX_ATTEMPTS', 5)),
    baseDelayMs: numberFromEnv('NOTIFICATION_RETRY_BASE_SECONDS', 30) * 1000,
    maxDelayMs: numberFromEnv('NOTIFICATION_RETRY_MAX_SECONDS', 900) * 1000,
    inlineRetries: numberFromEnv('NOTIFICATION_INLINE_RETRIES', 1),
    inlineDelayMs: numberFromEnv('NOTIFICATION_INLINE_RETRY_MS', 300),
    resendCooldownMs: numberFromEnv('NOTIFICATION_RESEND_COOLDOWN_SECONDS', 30) * 1000,
    escalationMs: numberFromEnv('NOTIFICATION_ESCALATION_MINUTES', 10) * 60 * 1000
  };
}

function isRetryable(code) {
  if (PERMANENT_ERRORS.has(code)) {
    return false;
  }
  const provider = /^EMAIL_PROVIDER_ERROR_(\d{3})$/.exec(code || '');
  if (provider) {
    const status = Number(provider[1]);
    return status === 429 || status >= 500;
  }
  return true;
}

// Exponential backoff with +-20% jitter: 30 s, 60 s, 120 s, ... capped at 15 min.
function retryDelayMs(attempts, config = settings()) {
  const exponential = config.baseDelayMs * 2 ** Math.max(0, attempts - 1);
  const capped = Math.min(exponential, config.maxDelayMs);
  return Math.round(capped * (0.8 + Math.random() * 0.4));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeError(error) {
  const text = error && error.message ? String(error.message) : 'UNKNOWN_ERROR';
  return text.slice(0, 200);
}

function escapeHtml(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value).replace(/[&<>"']/g, (char) => map[char]);
}

function displayName(person) {
  if (!person || typeof person !== 'object') {
    return '';
  }
  return person.fullName || person.name || '';
}

function refId(value) {
  return value && value._id ? value._id : value;
}

function notificationsLink() {
  const base = (process.env.APP_URL || '').trim().replace(/\/$/, '');
  return /^https?:\/\//.test(base) ? `${base}/notifications` : null;
}

function buildMessage(visitorName) {
  const who = visitorName || 'Your visitor';
  const link = notificationsLink();
  const action = link
    ? `<p><a href="${escapeHtml(link)}">Open the Visitor Management System</a> to acknowledge this notification.</p>`
    : '<p>Open the Visitor Management System to acknowledge this notification.</p>';
  return {
    subject: `${who} has arrived`,
    text: `${who} has checked in at the front desk and is waiting for you. Acknowledge it here: ${link || 'the Visitor Management System'}`,
    html: `<p><strong>${escapeHtml(who)}</strong> has checked in at the front desk and is waiting for you.</p>${action}`,
    title: 'Visitor arrived',
    body: `${who} has checked in and is waiting for you.`
  };
}

async function loadDeliveryContext(visitId, hostId) {
  const [visit, host] = await Promise.all([
    Visit.findById(visitId).populate({ path: 'visitorId', model: Visitor, select: 'fullName name' }),
    User.findById(hostId).select('name fullName email fcmTokens active')
  ]);

  const visitor = visit ? visit.visitorId : null;

  return { visitId, host, message: buildMessage(displayName(visitor)) };
}

async function removeInvalidTokens(hostId, tokens) {
  if (tokens.length === 0) {
    return;
  }
  await User.updateOne({ _id: hostId }, { $pull: { fcmTokens: { $in: tokens } } }).catch(() => null);
}

// One delivery attempt on one channel. Never throws.
async function deliver(channel, context) {
  const started = Date.now();
  try {
    if (!context) {
      throw new Error('DELIVERY_CONTEXT_UNAVAILABLE');
    }

    const { host, message } = context;

    if (!host) {
      throw new Error('HOST_NOT_FOUND');
    }

    if (channel === 'email') {
      await sendEmail({ to: host.email, subject: message.subject, text: message.text, html: message.html });
    } else {
      const link = process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, '')}/notifications` : null;
      const result = await sendPush({
        tokens: host.fcmTokens,
        title: message.title,
        body: message.body,
        data: { type: 'visitor-arrival', visitId: String(context.visitId) },
        link
      });

      await removeInvalidTokens(host._id, result.invalidTokens);

      if (result.successCount === 0) {
        throw new Error(result.errorCode || 'PUSH_DELIVERY_FAILED');
      }
    }

    return { ok: true, durationMs: Date.now() - started };
  } catch (error) {
    const code = safeError(error);
    return { ok: false, error: code, retryable: isRetryable(code), durationMs: Date.now() - started };
  }
}

// Runs one attempt (plus `inlineRetries` quick retries for temporary errors), then stores the
// outcome: Sent, Retrying (with nextRetryAt) or Failed.
async function runAttempts(notification, context, inlineRetries) {
  const config = settings();
  const maxAttempts = notification.maxAttempts || config.maxAttempts;
  let attempts = notification.attempts || 0;
  const log = [];
  let outcome;

  for (let round = 0; round <= inlineRetries; round += 1) {
    attempts += 1;
    outcome = await deliver(notification.channel, context);
    log.push({
      at: new Date(),
      status: outcome.ok ? 'Sent' : 'Failed',
      error: outcome.error,
      retryable: outcome.ok ? undefined : outcome.retryable,
      durationMs: outcome.durationMs
    });
    if (outcome.ok || !outcome.retryable || attempts >= maxAttempts) {
      break;
    }
    await sleep(config.inlineDelayMs);
  }

  const now = new Date();
  const set = { attempts, lastAttemptAt: now, lockedUntil: null };
  const unset = {};
  if (outcome.ok) {
    Object.assign(set, { status: 'Sent', sentAt: now, nextRetryAt: null });
    unset.error = '';
  } else if (outcome.retryable && attempts < maxAttempts) {
    Object.assign(set, { status: 'Retrying', error: outcome.error, nextRetryAt: new Date(now.getTime() + retryDelayMs(attempts, config)) });
  } else {
    Object.assign(set, { status: 'Failed', error: outcome.error, nextRetryAt: null });
  }

  const update = { $set: set, $push: { attemptLog: { $each: log, $slice: -ATTEMPT_LOG_LIMIT } } };
  if (Object.keys(unset).length) {
    update.$unset = unset;
  }

  // Only finish notifications that are still in flight; if the host acknowledged meanwhile
  // (status Cancelled) keep that, but still record the attempt.
  const saved = await Notification.findOneAndUpdate(
    { _id: notification._id, status: { $in: ['Pending', 'Retrying'] } },
    update,
    { new: true }
  );

  const result =
    saved ||
    (await Notification.findByIdAndUpdate(
      notification._id,
      { $set: { attempts, lastAttemptAt: now, lockedUntil: null }, $push: update.$push },
      { new: true }
    ));

  logger[outcome.ok ? 'info' : 'warn']('notification.attempt', {
    notificationId: String(notification._id),
    visitId: String(notification.visitId),
    channel: notification.channel,
    attempts,
    status: result ? result.status : set.status,
    error: outcome.error
  });

  return result;
}

function dedupeKey(visitId, channel) {
  return `${visitId}:${channel}:arrival`;
}

// Called by the check-in service. Never throws, so a notification problem never blocks check-in.
async function sendArrivalNotification(visit) {
  try {
    if (!visit || !visit._id || !visit.hostId) {
      return [];
    }

    const visitId = visit._id;
    const hostId = refId(visit.hostId);
    const config = settings();
    const context = await loadDeliveryContext(visitId, hostId).catch(() => null);

    const results = await Promise.all(
      CHANNELS.map(async (channel) => {
        let record;
        try {
          // The record is stored before delivery, so a crash mid-delivery still leaves a trace to retry.
          record = await Notification.create({
            visitId,
            hostId,
            channel,
            status: 'Pending',
            maxAttempts: config.maxAttempts,
            dedupeKey: dedupeKey(visitId, channel)
          });
        } catch (error) {
          if (error.code === 11000) {
            logger.warn('notification.duplicate_prevented', { visitId: String(visitId), channel });
            return Notification.findOne({ dedupeKey: dedupeKey(visitId, channel) });
          }
          throw error;
        }
        return runAttempts(record, context, config.inlineRetries);
      })
    );

    return results.filter(Boolean);
  } catch (error) {
    logger.error('notification.arrival_failed', { error: safeError(error) });
    return [];
  }
}

// Entry point used by the check-in service when a visitor arrives.
// - With an arrivals queue (floci): the arrival goes to SQS and the notifications function,
//   triggered by the queue, delivers it. Check-in answers at once with status "Queued".
// - Without a queue (Vercel, Docker, tests), or if the queue cannot be reached: deliver now.
async function notifyArrival(visit) {
  if (arrivalQueue.isEnabled()) {
    try {
      await arrivalQueue.sendArrival(visit);
      return CHANNELS.map((channel) => ({ channel, status: 'Queued' }));
    } catch (error) {
      logger.warn('notification.queue_unavailable', { visitId: String(visit._id), error: safeError(error) });
    }
  }
  return sendArrivalNotification(visit);
}

// Called by the notifications function for each SQS message. Safe to receive the same message
// twice (SQS delivers at least once): the dedupe key allows one arrival notification per channel.
async function handleArrivalMessage(message) {
  const visit = await Visit.findById(message.visitId);
  if (!visit) {
    logger.warn('notification.arrival_skipped', { visitId: message.visitId, reason: 'VISIT_NOT_FOUND' });
    return { skipped: 'VISIT_NOT_FOUND' };
  }
  if (visit.status !== 'Checked-in') {
    logger.info('notification.arrival_skipped', { visitId: message.visitId, reason: 'VISIT_NOT_ON_SITE' });
    return { skipped: 'VISIT_NOT_ON_SITE' };
  }
  const records = await sendArrivalNotification(visit);
  if (records.length === 0) {
    // Nothing could even be recorded (e.g. database problem): let SQS deliver the message again.
    throw new Error('ARRIVAL_NOT_RECORDED');
  }
  return { notified: records.map((record) => `${record.channel}:${record.status}`) };
}

async function cancelRetries(filter, reason) {
  const result = await Notification.updateMany(
    { ...filter, status: { $in: ['Pending', 'Retrying'] } },
    { $set: { status: 'Cancelled', error: reason, nextRetryAt: null, lockedUntil: null } }
  );
  return result.modifiedCount || 0;
}

// Delivers due automatic retries. Safe to run from several places at once: each notification
// is claimed with a short lease before it is delivered.
async function processDueRetries({ limit = 20 } = {}) {
  const summary = { processed: 0, sent: 0, retrying: 0, failed: 0, cancelled: 0 };

  for (let index = 0; index < limit; index += 1) {
    const now = new Date();
    const claimed = await Notification.findOneAndUpdate(
      {
        status: 'Retrying',
        nextRetryAt: { $lte: now },
        supersededBy: null,
        $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }]
      },
      { $set: { lockedUntil: new Date(now.getTime() + LEASE_MS) } },
      { new: true, sort: { nextRetryAt: 1 } }
    );

    if (!claimed) {
      break;
    }
    summary.processed += 1;

    const [visit, acknowledged] = await Promise.all([
      Visit.findById(claimed.visitId).select('status').lean(),
      Notification.exists({ visitId: claimed.visitId, hostId: claimed.hostId, acknowledgedAt: { $ne: null } })
    ]);

    let reason = null;
    if (!visit || visit.status !== 'Checked-in') {
      reason = 'VISIT_NO_LONGER_ON_SITE';
    } else if (acknowledged) {
      reason = 'ALREADY_ACKNOWLEDGED';
    }

    if (reason) {
      await cancelRetries({ _id: claimed._id }, reason);
      summary.cancelled += 1;
      logger.info('notification.retry_cancelled', { notificationId: String(claimed._id), reason });
      continue;
    }

    const context = await loadDeliveryContext(claimed.visitId, claimed.hostId).catch(() => null);
    const result = await runAttempts(claimed, context, 0);
    const status = result ? result.status : 'Failed';
    if (status === 'Sent') summary.sent += 1;
    else if (status === 'Retrying') summary.retrying += 1;
    else summary.failed += 1;
  }

  return summary;
}

// Whether this server can currently send on a channel. Checked at request time, so a channel
// configured after a notification failed (e.g. email added later) can be resent.
function isChannelConfigured(channel) {
  return channel === 'email' ? isEmailConfigured() : isFirebaseConfigured();
}

async function listNotifications(filter) {
  const notifications = await Notification.find(filter)
    .sort({ createdAt: -1 })
    .limit(LIST_LIMIT)
    .select('-dedupeKey -lockedUntil')
    .populate({ path: 'hostId', model: User, select: 'name fullName' })
    .populate({
      path: 'visitId',
      model: Visit,
      select: 'visitorId status',
      populate: { path: 'visitorId', model: Visitor, select: 'fullName name' }
    })
    .lean();
  return notifications.map((notification) => ({
    ...notification,
    channelConfigured: isChannelConfigured(notification.channel)
  }));
}

async function findNotificationById(id) {
  return Notification.findById(id);
}

async function findVisitStatus(visitId) {
  const visit = await Visit.findById(visitId).select('status').lean();
  return visit ? visit.status : null;
}

// The host acknowledges the arrival, not a single channel: every notification of that visit
// is marked, and pending retries are stopped so the host is not notified again.
async function acknowledgeNotification(id, userId) {
  const notification = await Notification.findById(id);
  if (!notification) {
    return null;
  }
  const now = new Date();
  const scope = { visitId: notification.visitId, hostId: notification.hostId };
  const result = await Notification.updateMany(
    { ...scope, acknowledgedAt: null },
    { $set: { acknowledgedAt: now, acknowledgedBy: userId } }
  );
  if (!result.modifiedCount) {
    return null;
  }
  const stoppedRetries = await cancelRetries(scope, 'ALREADY_ACKNOWLEDGED');
  logger.info('notification.acknowledged', {
    visitId: String(notification.visitId),
    hostId: String(notification.hostId),
    responseSeconds: Math.round((now - notification.createdAt) / 1000),
    stoppedRetries
  });
  const updated = await Notification.findById(id).select('-dedupeKey -lockedUntil').lean();
  return { ...updated, acknowledgedCount: result.modifiedCount, stoppedRetries };
}

function resendCooldownRemaining(notification) {
  const { resendCooldownMs } = settings();
  const last = notification.lastAttemptAt || notification.createdAt;
  const remaining = resendCooldownMs - (Date.now() - new Date(last).getTime());
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

// Manual resend by staff. Atomically marks the original as replaced, so two clicks (or two
// staff members) cannot create two resends of the same failed notification.
async function resendNotification(original) {
  const newId = new mongoose.Types.ObjectId();
  const claimed = await Notification.findOneAndUpdate(
    { _id: original._id, supersededBy: null, status: { $in: ['Failed', 'Retrying'] } },
    {
      $set: {
        supersededBy: newId,
        nextRetryAt: null,
        lockedUntil: null,
        ...(original.status === 'Retrying' ? { status: 'Cancelled' } : {})
      }
    },
    { new: true }
  );

  if (!claimed) {
    return null;
  }

  const config = settings();
  const attempt = await Notification.create({
    _id: newId,
    visitId: original.visitId,
    hostId: original.hostId,
    channel: original.channel,
    resendOf: original._id,
    status: 'Pending',
    maxAttempts: config.maxAttempts
  });

  const context = await loadDeliveryContext(original.visitId, original.hostId).catch(() => null);
  const result = await runAttempts(attempt, context, config.inlineRetries);
  logger.info('notification.resent', { originalId: String(original._id), notificationId: String(newId), status: result.status });
  return Notification.findById(newId).select('-dedupeKey -lockedUntil').lean();
}

// Front-desk overview: delivery health, retries and hosts who have not responded yet.
async function notificationSummary({ hours = 24 } = {}) {
  const config = settings();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const [byStatus, byChannel, ackTimes, onSiteVisits] = await Promise.all([
    Notification.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Notification.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: '$channel',
          total: { $sum: 1 },
          sent: { $sum: { $cond: [{ $eq: ['$status', 'Sent'] }, 1, 0] } },
          attempts: { $sum: '$attempts' }
        }
      }
    ]),
    Notification.aggregate([
      { $match: { createdAt: { $gte: since }, acknowledgedAt: { $ne: null }, resendOf: null } },
      { $group: { _id: '$visitId', notifiedAt: { $min: '$createdAt' }, acknowledgedAt: { $min: '$acknowledgedAt' } } },
      { $group: { _id: null, average: { $avg: { $subtract: ['$acknowledgedAt', '$notifiedAt'] } }, count: { $sum: 1 } } }
    ]),
    Visit.find({ status: 'Checked-in' })
      .select('_id visitorId hostId checkInTime')
      .populate('visitorId', 'fullName')
      .populate('hostId', 'name')
      .lean()
  ]);

  const visitIds = onSiteVisits.map((visit) => visit._id);
  const perVisit = visitIds.length
    ? await Notification.aggregate([
        { $match: { visitId: { $in: visitIds } } },
        {
          $group: {
            _id: '$visitId',
            firstNotifiedAt: { $min: '$createdAt' },
            acknowledged: { $max: { $cond: [{ $ne: ['$acknowledgedAt', null] }, 1, 0] } },
            delivered: { $max: { $cond: [{ $eq: ['$status', 'Sent'] }, 1, 0] } },
            needsResend: {
              $max: { $cond: [{ $and: [{ $eq: ['$status', 'Failed'] }, { $eq: ['$supersededBy', null] }] }, 1, 0] }
            }
          }
        }
      ])
    : [];
  const stats = new Map(perVisit.map((row) => [String(row._id), row]));

  const awaitingAcknowledgement = [];
  const undelivered = [];
  onSiteVisits.forEach((visit) => {
    const row = stats.get(String(visit._id));
    if (!row || row.acknowledged) {
      return;
    }
    const item = {
      visitId: visit._id,
      visitor: visit.visitorId ? visit.visitorId.fullName : null,
      host: visit.hostId ? visit.hostId.name : null,
      notifiedAt: row.firstNotifiedAt,
      minutesWaiting: Math.round((Date.now() - new Date(row.firstNotifiedAt).getTime()) / 60000)
    };
    if (!row.delivered && row.needsResend) {
      undelivered.push(item);
    }
    if (Date.now() - new Date(row.firstNotifiedAt).getTime() >= config.escalationMs) {
      awaitingAcknowledgement.push(item);
    }
  });

  const counts = Object.fromEntries(Notification.STATUSES.map((status) => [status, 0]));
  byStatus.forEach((row) => {
    counts[row._id] = row.count;
  });

  return {
    windowHours: hours,
    counts,
    channels: byChannel.map((row) => ({
      channel: row._id,
      total: row.total,
      sent: row.sent,
      deliveryRate: row.total ? Number((row.sent / row.total).toFixed(3)) : 0,
      averageAttempts: row.total ? Number((row.attempts / row.total).toFixed(2)) : 0
    })),
    acknowledgement: {
      acknowledgedVisits: ackTimes[0] ? ackTimes[0].count : 0,
      averageSeconds: ackTimes[0] ? Math.round(ackTimes[0].average / 1000) : null
    },
    escalationMinutes: Math.round(config.escalationMs / 60000),
    awaitingAcknowledgement,
    undelivered,
    generatedAt: new Date()
  };
}

async function saveFcmToken(userId, token) {
  await User.updateMany({ _id: { $ne: userId }, fcmTokens: token }, { $pull: { fcmTokens: token } });
  const result = await User.updateOne({ _id: userId }, { $addToSet: { fcmTokens: token } });
  return result.matchedCount > 0;
}

module.exports = {
  sendArrivalNotification,
  notifyArrival,
  handleArrivalMessage,
  processDueRetries,
  listNotifications,
  findNotificationById,
  findVisitStatus,
  acknowledgeNotification,
  resendNotification,
  resendCooldownRemaining,
  notificationSummary,
  saveFcmToken,
  isChannelConfigured,
  isRetryable,
  retryDelayMs
};
