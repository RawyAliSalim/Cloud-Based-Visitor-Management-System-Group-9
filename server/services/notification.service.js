const Notification = require('../models/Notification');
const User = require('../models/User');
const Visit = require('../models/Visit');
const Visitor = require('../models/Visitor');
const { sendEmail } = require('./email.service');
const { sendPush } = require('./push.service');

const CHANNELS = ['email', 'push'];
const LIST_LIMIT = 200;

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

function buildMessage(visitorName) {
  const who = visitorName || 'Your visitor';
  return {
    subject: `${who} has arrived`,
    text: `${who} has checked in at the front desk and is waiting for you. Open the Visitor Management System to acknowledge this notification.`,
    html: `<p><strong>${escapeHtml(who)}</strong> has checked in at the front desk and is waiting for you.</p><p>Open the Visitor Management System to acknowledge this notification.</p>`,
    title: 'Visitor arrived',
    body: `${who} has checked in and is waiting for you.`
  };
}

async function loadDeliveryContext(visitId, hostId) {
  const [visit, host] = await Promise.all([
    Visit.findById(visitId).populate({ path: 'visitorId', model: Visitor, select: 'fullName name' }),
    User.findById(hostId).select('name fullName email fcmTokens')
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

async function deliver(channel, context) {
  try {
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

    return { status: 'Sent', sentAt: new Date() };
  } catch (error) {
    return { status: 'Failed', error: safeError(error) };
  }
}

async function sendArrivalNotification(visit) {
  try {
    if (!visit || !visit._id || !visit.hostId) {
      return [];
    }

    const visitId = visit._id;
    const hostId = refId(visit.hostId);
    const context = await loadDeliveryContext(visitId, hostId).catch(() => null);

    const results = context
      ? await Promise.all(CHANNELS.map((channel) => deliver(channel, context)))
      : CHANNELS.map(() => ({ status: 'Failed', error: 'DELIVERY_CONTEXT_UNAVAILABLE' }));

    return await Notification.insertMany(
      CHANNELS.map((channel, index) => ({ visitId, hostId, channel, ...results[index] }))
    );
  } catch (error) {
    console.error('Arrival notification could not be saved:', safeError(error));
    return [];
  }
}

async function listNotifications(filter) {
  return Notification.find(filter)
    .sort({ createdAt: -1 })
    .limit(LIST_LIMIT)
    .populate({ path: 'hostId', model: User, select: 'name fullName' })
    .populate({
      path: 'visitId',
      model: Visit,
      select: 'visitorId status',
      populate: { path: 'visitorId', model: Visitor, select: 'fullName name' }
    })
    .lean();
}

async function findNotificationById(id) {
  return Notification.findById(id);
}

async function acknowledgeNotification(id) {
  return Notification.findOneAndUpdate(
    { _id: id, acknowledgedAt: null },
    { $set: { acknowledgedAt: new Date() } },
    { new: true }
  );
}

async function resendNotification(original) {
  const context = await loadDeliveryContext(original.visitId, original.hostId);
  const result = await deliver(original.channel, context);

  return Notification.create({
    visitId: original.visitId,
    hostId: original.hostId,
    channel: original.channel,
    resendOf: original._id,
    ...result
  });
}

async function saveFcmToken(userId, token) {
  await User.updateMany({ _id: { $ne: userId }, fcmTokens: token }, { $pull: { fcmTokens: token } });
  const result = await User.updateOne({ _id: userId }, { $addToSet: { fcmTokens: token } });
  return result.matchedCount > 0;
}

module.exports = {
  sendArrivalNotification,
  listNotifications,
  findNotificationById,
  acknowledgeNotification,
  resendNotification,
  saveFcmToken
};
