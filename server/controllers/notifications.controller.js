const notificationService = require('../services/notification.service');

const STATUSES = new Set(['Sent', 'Failed']);
const STAFF_ROLES = new Set(['front-desk', 'admin']);
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const MAX_TOKEN_LENGTH = 4096;

function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
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
        return sendError(res, 400, 'VALIDATION_ERROR', 'status must be Sent or Failed');
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

    const updated = await notificationService.acknowledgeNotification(id);
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

    if (original.status !== 'Failed') {
      return sendError(res, 409, 'NOTIFICATION_NOT_FAILED', 'Only failed notifications can be resent');
    }

    const attempt = await notificationService.resendNotification(original);
    return res.status(201).json(attempt);
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
  saveFcmToken
};
