const visitService = require('../services/visit.service');
const { sendArrivalNotification } = require('../services/notification.service');
const { sendError, isObjectId } = require('../middleware/validate');

const STATUSES = new Set(['Expected', 'Checked-in', 'Checked-out', 'Cancelled']);

function parseDate(value) {
  if (typeof value !== 'string' || !value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isStaff(user) {
  return user.role === 'front-desk' || user.role === 'admin';
}

async function checkIn(req, res, next) {
  try {
    const visit = await visitService.findVisitById(req.params.id);
    if (!visit) {
      return sendError(res, 404, 'VISIT_NOT_FOUND', 'Visit not found');
    }

    if (visit.status !== 'Expected') {
      return sendError(res, 409, 'VISIT_NOT_EXPECTED', 'Only Expected visits can be checked in');
    }

    const updated = await visitService.changeStatus(visit._id, 'Expected', {
      status: 'Checked-in',
      checkInTime: new Date()
    });

    if (!updated) {
      return sendError(res, 409, 'VISIT_NOT_EXPECTED', 'Only Expected visits can be checked in');
    }

    const notifications = await sendArrivalNotification(updated);
    const result = await visitService.findVisitDetails(updated._id, { includeContact: true });

    return res.status(200).json({
      ...result,
      notifications: notifications.map((notification) => ({
        channel: notification.channel,
        status: notification.status
      }))
    });
  } catch (error) {
    return next(error);
  }
}

async function checkOut(req, res, next) {
  try {
    const visit = await visitService.findVisitById(req.params.id);
    if (!visit) {
      return sendError(res, 404, 'VISIT_NOT_FOUND', 'Visit not found');
    }

    if (visit.status !== 'Checked-in') {
      return sendError(res, 409, 'VISIT_NOT_CHECKED_IN', 'Only Checked-in visits can be checked out');
    }

    const updated = await visitService.changeStatus(visit._id, 'Checked-in', {
      status: 'Checked-out',
      checkOutTime: new Date()
    });

    if (!updated) {
      return sendError(res, 409, 'VISIT_NOT_CHECKED_IN', 'Only Checked-in visits can be checked out');
    }

    const result = await visitService.findVisitDetails(updated._id, { includeContact: true });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function listVisits(req, res, next) {
  try {
    const user = req.session.user;
    const { status, hostId, visitor, from, to } = req.query;
    const filters = {};

    if (status !== undefined) {
      if (!STATUSES.has(status)) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'status is not valid');
      }
      filters.status = status;
    }

    if (hostId !== undefined && !isObjectId(hostId)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'hostId must be a valid id');
    }

    if (user.role === 'host') {
      if (hostId !== undefined && hostId.toLowerCase() !== user._id.toLowerCase()) {
        return sendError(res, 403, 'FORBIDDEN', 'Hosts can only view their own visits');
      }
      filters.hostId = user._id;
    } else if (hostId !== undefined) {
      filters.hostId = hostId;
    }

    if (visitor !== undefined) {
      if (typeof visitor !== 'string' || visitor.trim().length > 100) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'visitor must be at most 100 characters');
      }
      if (visitor.trim()) {
        filters.visitorName = visitor.trim();
      }
    }

    if (from !== undefined) {
      filters.from = parseDate(from);
      if (!filters.from) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'from must be a valid date');
      }
    }

    if (to !== undefined) {
      filters.to = parseDate(to);
      if (!filters.to) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'to must be a valid date');
      }
    }

    if (filters.from && filters.to && filters.from > filters.to) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'from must be before to');
    }

    const visits = await visitService.listVisits(filters);
    return res.status(200).json(visits);
  } catch (error) {
    return next(error);
  }
}

async function listOnSite(req, res, next) {
  try {
    const visits = await visitService.listOnSiteVisits();
    return res.status(200).json(visits);
  } catch (error) {
    return next(error);
  }
}

async function getVisit(req, res, next) {
  try {
    const user = req.session.user;
    const visit = await visitService.findVisitDetails(req.params.id, { includeContact: isStaff(user) });

    if (!visit) {
      return sendError(res, 404, 'VISIT_NOT_FOUND', 'Visit not found');
    }

    const hostId = visit.hostId && visit.hostId._id ? visit.hostId._id : visit.hostId;
    if (user.role === 'host' && String(hostId) !== user._id) {
      return sendError(res, 403, 'FORBIDDEN', 'You can only view your own visits');
    }

    return res.status(200).json(visit);
  } catch (error) {
    return next(error);
  }
}

module.exports = { checkIn, checkOut, listVisits, listOnSite, getVisit };
