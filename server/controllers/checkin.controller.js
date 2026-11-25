const visitService = require('../services/visit.service');
const reportService = require('../services/report.service');
const archiveService = require('../services/archive.service');
const userService = require('../services/user.service');
const { notifyArrival } = require('../services/notification.service');
const logger = require('../utils/logger');
const { sendError, isObjectId } = require('../middleware/validate');

const STATUSES = new Set(['Expected', 'Checked-in', 'Checked-out', 'Cancelled']);
const MAX_REPORT_DAYS = 92;
const DAY_MS = 24 * 60 * 60 * 1000;

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

// How early a visitor may be checked in, and how long after the expected time the visit is still valid.
function checkInWindow() {
  return {
    earlyMs: numberFromEnv('CHECKIN_EARLY_MINUTES', 120) * 60 * 1000,
    lateMs: numberFromEnv('CHECKIN_LATE_HOURS', 12) * 60 * 60 * 1000
  };
}

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

function validTimezone(value) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch (error) {
    return false;
  }
}

// Explains why a check-in is not allowed, or returns null if it is.
async function checkInProblem(visit, now) {
  if (visit.status !== 'Expected') {
    const reasons = {
      'Checked-in': 'This visitor is already checked in',
      'Checked-out': 'This visit is already finished',
      Cancelled: 'This visit was cancelled'
    };
    return { code: 'VISIT_NOT_EXPECTED', message: reasons[visit.status] || 'Only Expected visits can be checked in' };
  }

  const { earlyMs, lateMs } = checkInWindow();
  const expected = new Date(visit.expectedArrival).getTime();

  if (now < expected - earlyMs) {
    return {
      code: 'CHECK_IN_TOO_EARLY',
      message: `Check-in opens ${Math.round(earlyMs / 60000)} minutes before the expected arrival time`,
      details: { opensAt: new Date(expected - earlyMs) }
    };
  }

  if (now > expected + lateMs) {
    return {
      code: 'VISIT_EXPIRED',
      message: 'The expected arrival time has passed; edit the visit or register a new one',
      details: { expiredAt: new Date(expected + lateMs) }
    };
  }

  const host = await userService.findActiveHost(String(visit.hostId));
  if (!host) {
    return { code: 'HOST_UNAVAILABLE', message: 'The host account is no longer active; change the host first' };
  }

  const onSite = await visitService.findOtherVisitOnSite(visit.visitorId, visit._id);
  if (onSite) {
    return {
      code: 'VISITOR_ALREADY_ON_SITE',
      message: 'This visitor is already checked in on another visit; check them out first',
      details: { visitId: String(onSite._id) }
    };
  }

  return null;
}

function conflict(res, problem) {
  const body = { error: { code: problem.code, message: problem.message } };
  if (problem.details) {
    body.error.details = problem.details;
  }
  return res.status(409).json(body);
}

async function checkIn(req, res, next) {
  try {
    const user = req.session.user;
    const visit = await visitService.findVisitById(req.params.id);
    if (!visit) {
      return sendError(res, 404, 'VISIT_NOT_FOUND', 'Visit not found');
    }

    const now = Date.now();
    const problem = await checkInProblem(visit, now);
    if (problem) {
      logger.warn('visit.check_in_refused', { requestId: req.id, visitId: String(visit._id), reason: problem.code });
      return conflict(res, problem);
    }

    // Atomic: only one of several simultaneous check-in requests can move the visit out of Expected.
    const updated = await visitService.changeStatus(
      visit._id,
      'Expected',
      { status: 'Checked-in', checkInTime: new Date(now), checkedInBy: user._id },
      user._id
    );

    if (!updated) {
      return sendError(res, 409, 'VISIT_NOT_EXPECTED', 'This visit was changed by someone else; refresh and try again');
    }

    logger.info('visit.checked_in', {
      requestId: req.id,
      visitId: String(updated._id),
      hostId: String(updated.hostId),
      by: user._id,
      minutesFromExpected: Math.round((now - new Date(updated.expectedArrival).getTime()) / 60000)
    });

    const notifications = await notifyArrival(updated);
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
    const user = req.session.user;
    const visit = await visitService.findVisitById(req.params.id);
    if (!visit) {
      return sendError(res, 404, 'VISIT_NOT_FOUND', 'Visit not found');
    }

    if (visit.status !== 'Checked-in') {
      const message =
        visit.status === 'Checked-out'
          ? 'This visitor is already checked out'
          : 'Only Checked-in visits can be checked out';
      return sendError(res, 409, 'VISIT_NOT_CHECKED_IN', message);
    }

    const updated = await visitService.changeStatus(
      visit._id,
      'Checked-in',
      { status: 'Checked-out', checkOutTime: new Date(), checkedOutBy: user._id },
      user._id
    );

    if (!updated) {
      return sendError(res, 409, 'VISIT_NOT_CHECKED_IN', 'Only Checked-in visits can be checked out');
    }

    const result = await visitService.findVisitDetails(updated._id, { includeContact: true });
    logger.info('visit.checked_out', {
      requestId: req.id,
      visitId: String(updated._id),
      by: user._id,
      durationMinutes: result.durationMinutes
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function listVisits(req, res, next) {
  try {
    const user = req.session.user;
    const { status, hostId, visitor, from, to, dateField } = req.query;
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

    if (dateField !== undefined) {
      if (!Object.prototype.hasOwnProperty.call(visitService.DATE_FIELDS, dateField)) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'dateField must be expected, checkIn or checkOut');
      }
      filters.dateField = dateField;
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

// Shared validation for report and export query parameters.
// Defaults to the last 7 days plus the next 24 hours (so today's upcoming visits are included).
function readReportRange(query) {
  const to = query.to !== undefined ? parseDate(query.to) : new Date(Date.now() + DAY_MS);
  if (!to) {
    return { error: 'to must be a valid date' };
  }
  const from = query.from !== undefined ? parseDate(query.from) : new Date(to.getTime() - 8 * DAY_MS);
  if (!from) {
    return { error: 'from must be a valid date' };
  }
  if (from > to) {
    return { error: 'from must be before to' };
  }
  if (to.getTime() - from.getTime() > MAX_REPORT_DAYS * DAY_MS) {
    return { error: `Reports can cover at most ${MAX_REPORT_DAYS} days` };
  }
  if (query.hostId !== undefined && !isObjectId(query.hostId)) {
    return { error: 'hostId must be a valid id' };
  }
  const timezone = query.tz || process.env.REPORT_TIMEZONE || 'UTC';
  if (typeof timezone !== 'string' || !validTimezone(timezone)) {
    return { error: 'tz must be a valid IANA time zone, e.g. Africa/Cairo' };
  }
  return { from, to, hostId: query.hostId, timezone };
}

async function activityReport(req, res, next) {
  try {
    const range = readReportRange(req.query);
    if (range.error) {
      return sendError(res, 400, 'VALIDATION_ERROR', range.error);
    }
    const report = await reportService.activityReport(range);
    return res.status(200).json(report);
  } catch (error) {
    return next(error);
  }
}

async function exportVisits(req, res, next) {
  try {
    const range = readReportRange(req.query);
    if (range.error) {
      return sendError(res, 400, 'VALIDATION_ERROR', range.error);
    }
    const csv = await reportService.exportVisitsCsv(range);
    const name = `visitor-log-${range.from.toISOString().slice(0, 10)}-to-${range.to.toISOString().slice(0, 10)}.csv`;
    logger.info('report.exported', { requestId: req.id, by: req.session.user._id });

    // Keep a copy in S3 (floci deployment). A storage problem must not block the download.
    try {
      const location = await archiveService.archiveReport({ fileName: name, csv, exportedBy: req.session.user._id });
      if (location) {
        res.set('X-Report-Archive', location);
      }
    } catch (error) {
      logger.warn('report.archive_failed', { requestId: req.id, error: error.message });
    }
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${name}"`);
    res.set('Cache-Control', 'no-store');
    return res.status(200).send(csv);
  } catch (error) {
    return next(error);
  }
}

module.exports = { checkIn, checkOut, listVisits, listOnSite, getVisit, activityReport, exportVisits };
