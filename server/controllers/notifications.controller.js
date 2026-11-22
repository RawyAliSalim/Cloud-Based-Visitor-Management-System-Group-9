const crypto = require('crypto');
const notificationService = require('../services/notification.service');
const Notification = require('../models/Notification');
const logger = require('../utils/logger');

const STATUSES = new Set(Notification.STATUSES);
const STAFF_ROLES = new Set(['front-desk', 'admin']);
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const MAX_TOKEN_LENGTH = 4096;
const OPPORTUNISTIC_RETRY_LIMIT = 5;

function sendError(res, status, code, message, details) {
  const body = { error: { code, message } };
  if (details) {
    body.error.details = details;
  }
  return res.status(status).json(body);
}

function isObjectId(value) {
  return typeof value === 'string' && OBJECT_ID_PATTERN.test(value);
}

function currentUser(req) {
  const user = req.session && req.session.user;
  if (!user) {
    return null;
  }
  return { id: String(user._id || user.id).toLowerCase(), role: user.role };
}

// On Vercel there is no always-running worker, so due retries are also processed
// (a few at a time) whenever someone opens the notification list.
async function runDueRetriesQuietly(requestId) {
  try {
    const summary = await notificationService.processDueRetries({ limit: OPPORTUNISTIC_RETRY_LIMIT });
    if (summary.processed > 0) {
      logger.info('notification.retries_processed', { requestId, trigger: 'list', ...summary });
    }
  } catch (error) {
    logger.warn('notification.retries_failed', { requestId, error: error.message });
  }
}

async function listNotifications(req, res, next) {
  try {
    const user = currentUser(req);
    if (!user) {
      return sendError(res, 401, 'UNAUTHORIZED', 'You must be logged in');
    }

    const { visitId, hostId, status } = req.query;
    const filter = {};

    if (visitId !== undefined) {
      if (!isObjectId(visitId)) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'visitId must be a valid id');
      }
      filter.visitId = visitId;
    }

    if (status !== undefined) {
      if (!STATUSES.has(status)) {
        return sendError(res, 400, 'VALIDATION_ERROR', `status must be one of ${[...STATUSES].join(', ')}`);
      }
      filter.status = status;
    }

    if (hostId !== undefined && !isObjectId(hostId)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'hostId must be a valid id');
    }

    if (user.role === 'host') {
      if (hostId !== undefined && hostId.toLowerCase() !== user.id) {
        return sendError(res, 403, 'FORBIDDEN', 'Hosts can only view their own notifications');
      }
      filter.hostId = user.id;
    } else if (STAFF_ROLES.has(user.role)) {
      if (hostId !== undefined) {
        filter.hostId = hostId;
      }
    } else {
      return sendError(res, 403, 'FORBIDDEN', 'You are not allowed to view notifications');
    }

    await runDueRetriesQuietly(req.id);

    const notifications = await notificationService.listNotifications(filter);
    return res.status(200).json(notifications);
  } catch (error) {
    return next(error);
  }
}

async function acknowledgeNotification(req, res, next) {
  try {
    const user = currentUser(req);
    if (!user) {
      return sendError(res, 401, 'UNAUTHORIZED', 'You must be logged in');
    }

    if (user.role !== 'host') {
      return sendError(res, 403, 'FORBIDDEN', 'Only hosts can acknowledge notifications');
    }

    const { id } = req.params;
    if (!isObjectId(id)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Notification id is not valid');
    }

    const notification = await notificationService.findNotificationById(id);
    if (!notification) {
      return sendError(res, 404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
    }

    if (String(notification.hostId).toLowerCase() !== user.id) {
      return sendError(res, 403, 'FORBIDDEN', 'You can only acknowledge your own notifications');
    }

    if (notification.acknowledgedAt) {
      return sendError(res, 409, 'NOTIFICATION_ALREADY_ACKNOWLEDGED', 'Notification has already been acknowledged');
    }

    const visitStatus = await notificationService.findVisitStatus(notification.visitId);
    if (visitStatus !== 'Checked-in') {
      return sendError(
        res,
        409,
        'VISIT_NOT_ON_SITE',
        'The visitor is no longer waiting (the visit is not checked in), so there is nothing to acknowledge'
      );
    }

    const updated = await notificationService.acknowledgeNotification(id, user.id);
    if (!updated) {
      return sendError(res, 409, 'NOTIFICATION_ALREADY_ACKNOWLEDGED', 'Notification has already been acknowledged');
    }

    return res.status(200).json(updated);
  } catch (error) {
    return next(error);
  }
}

async function resendNotification(req, res, next) {
  try {
    const user = currentUser(req);
    if (!user) {
      return sendError(res, 401, 'UNAUTHORIZED', 'You must be logged in');
    }

    if (!STAFF_ROLES.has(user.role)) {
      return sendError(res, 403, 'FORBIDDEN', 'Only front-desk staff or admins can resend notifications');
    }

    const { id } = req.params;
    if (!isObjectId(id)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Notification id is not valid');
    }

    const original = await notificationService.findNotificationById(id);
    if (!original) {
      return sendError(res, 404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
    }

    if (original.status !== 'Failed' && original.status !== 'Retrying') {
      return sendError(res, 409, 'NOTIFICATION_NOT_FAILED', 'Only failed notifications can be resent');
    }

    if (original.supersededBy) {
      return sendError(res, 409, 'NOTIFICATION_ALREADY_RESENT', 'This notification has already been resent', {
        notificationId: String(original.supersededBy)
      });
    }

    if (original.acknowledgedAt) {
      return sendError(res, 409, 'NOTIFICATION_ALREADY_ACKNOWLEDGED', 'The host has already acknowledged this visit');
    }

    const visitStatus = await notificationService.findVisitStatus(original.visitId);
    if (visitStatus !== 'Checked-in') {
      return sendError(res, 409, 'VISIT_NOT_ON_SITE', 'The visitor is no longer checked in');
    }

    const wait = notificationService.resendCooldownRemaining(original);
    if (wait > 0) {
      res.set('Retry-After', String(wait));
      return sendError(res, 429, 'RESEND_TOO_SOON', `Please wait ${wait} seconds before resending`, { retryAfterSeconds: wait });
    }

    const attempt = await notificationService.resendNotification(original);
    if (!attempt) {
      return sendError(res, 409, 'NOTIFICATION_ALREADY_RESENT', 'This notification has already been resent');
    }

    return res.status(201).json(attempt);
  } catch (error) {
    return next(error);
  }
}

function hasCronSecret(req) {
  const secret = process.env.CRON_SECRET;
  const header = req.get('authorization') || '';
  if (!secret || !header.startsWith('Bearer ')) {
    return false;
  }
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// Processes due automatic retries now. Front-desk staff/admins, or a scheduler with CRON_SECRET.
async function retryDue(req, res, next) {
  try {
    const user = currentUser(req);
    const allowed = (user && STAFF_ROLES.has(user.role)) || hasCronSecret(req);
    if (!allowed) {
      return user
        ? sendError(res, 403, 'FORBIDDEN', 'Only front-desk staff or admins can run retries')
        : sendError(res, 401, 'UNAUTHORIZED', 'You must be logged in');
    }
    const summary = await notificationService.processDueRetries({ limit: 50 });
    logger.info('notification.retries_processed', { requestId: req.id, trigger: user ? 'staff' : 'cron', ...summary });
    return res.status(200).json(summary);
  } catch (error) {
    return next(error);
  }
}

async function summary(req, res, next) {
  try {
    const hours = req.query.hours === undefined ? 24 : Number(req.query.hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'hours must be a whole number from 1 to 168');
    }
    return res.status(200).json(await notificationService.notificationSummary({ hours }));
  } catch (error) {
    return next(error);
  }
}

async function saveFcmToken(req, res, next) {
  try {
    const user = currentUser(req);
    if (!user) {
      return sendError(res, 401, 'UNAUTHORIZED', 'You must be logged in');
    }

    if (!req.is('application/json')) {
      return sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
    }

    const token = req.body && typeof req.body.token === 'string' ? req.body.token.trim() : '';
    if (!token || token.length > MAX_TOKEN_LENGTH) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'token is required');
    }

    const saved = await notificationService.saveFcmToken(user.id, token);
    if (!saved) {
      return sendError(res, 404, 'USER_NOT_FOUND', 'User not found');
    }

    return res.status(200).json({ message: 'Browser notifications enabled' });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listNotifications,
  acknowledgeNotification,
  resendNotification,
  retryDue,
  summary,
  saveFcmToken
};
