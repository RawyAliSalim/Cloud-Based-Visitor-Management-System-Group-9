const visitService = require('../services/visit.service');
const visitorService = require('../services/visitor.service');
const userService = require('../services/user.service');
const registration = require('../services/registration.service');
const logger = require('../utils/logger');
const Visit = require('../models/Visit');
const { sendError, isObjectId, isEmail, isPhone } = require('../middleware/validate');

const PAST_GRACE_MS = 5 * 60 * 1000;
const MAX_ADVANCE_DAYS = 90;
const VISITOR_FIELDS = ['fullName', 'email', 'phone', 'company'];
const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}\p{N}' .-]*$/u;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const MARKUP_CHARS = /[<>]/;
const IDEMPOTENCY_KEY_PATTERN = /^[\w-]{8,100}$/;

function cleanText(value) {
  return value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

function readVisitorDetails(body) {
  const details = {};
  VISITOR_FIELDS.forEach((field) => {
    if (body[field] !== undefined) {
      details[field] = typeof body[field] === 'string' ? cleanText(body[field]) : body[field];
    }
  });
  return details;
}

function validateVisitorDetails(details, requireName) {
  const notText = VISITOR_FIELDS.find((field) => details[field] !== undefined && typeof details[field] !== 'string');
  if (notText) {
    return `${notText} must be text`;
  }
  if (requireName && !details.fullName) {
    return 'fullName is required';
  }
  if (details.fullName !== undefined) {
    if (details.fullName.length < 2 || details.fullName.length > 100) {
      return 'fullName must be 2 to 100 characters';
    }
    if (!NAME_PATTERN.test(details.fullName)) {
      return 'fullName must start with a letter and may only contain letters, digits, spaces, apostrophes, dots and hyphens';
    }
  }
  if (details.email && (!isEmail(details.email) || details.email.length > 254)) {
    return 'email is not valid';
  }
  if (details.phone && !isPhone(details.phone)) {
    return 'phone is not valid';
  }
  if (details.company !== undefined && (details.company.length > 100 || MARKUP_CHARS.test(details.company))) {
    return 'company must be at most 100 characters and cannot contain < or >';
  }
  return null;
}

function validatePurpose(purpose, required) {
  if (purpose === undefined) {
    return required ? 'purpose is required' : null;
  }
  if (typeof purpose !== 'string') {
    return 'purpose must be 1 to 200 characters';
  }
  const text = cleanText(purpose);
  if (!text || text.length > 200) {
    return 'purpose must be 1 to 200 characters';
  }
  if (MARKUP_CHARS.test(text)) {
    return 'purpose cannot contain < or >';
  }
  return null;
}

function parseArrival(value, required) {
  if (value === undefined) {
    return required ? { error: 'expectedArrival is required' } : {};
  }
  const date = typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return { error: 'expectedArrival must be a valid date' };
  }
  if (date.getTime() < Date.now() - PAST_GRACE_MS) {
    return { error: 'expectedArrival cannot be in the past' };
  }
  if (date.getTime() > Date.now() + MAX_ADVANCE_DAYS * 24 * 60 * 60 * 1000) {
    return { error: `expectedArrival cannot be more than ${MAX_ADVANCE_DAYS} days ahead` };
  }
  return { date };
}

async function resolveHostId(user, requestedHostId, required) {
  if (user.role === 'host') {
    if (requestedHostId !== undefined && String(requestedHostId).toLowerCase() !== user._id.toLowerCase()) {
      return { status: 403, code: 'FORBIDDEN', message: 'Hosts can only register visits for themselves' };
    }
    return { hostId: required ? user._id : undefined };
  }

  if (requestedHostId === undefined) {
    return required ? { status: 400, code: 'VALIDATION_ERROR', message: 'hostId is required' } : {};
  }

  if (!isObjectId(requestedHostId)) {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'hostId must be a valid id' };
  }

  const host = await userService.findActiveHost(requestedHostId);
  if (!host) {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'Host does not exist or is not an active host' };
  }

  return { hostId: requestedHostId };
}

function canManageVisit(user, visit) {
  return user.role !== 'host' || String(visit.hostId) === user._id;
}

function sendRegistrationError(res, error) {
  const body = { error: { code: error.code, message: error.message } };
  if (error.details) {
    body.error.details = error.details;
  }
  return res.status(error.status).json(body);
}

function readIdempotencyKey(req) {
  const key = req.get('idempotency-key');
  if (key === undefined) {
    return { key: null };
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return { error: 'Idempotency-Key must be 8 to 100 letters, digits, - or _' };
  }
  return { key };
}

async function findReplay(user, key) {
  return Visit.findOne({ createdBy: user._id, registrationKey: key }).select('+registrationKey');
}

function sameRequest(visit, { hostId, purpose, expectedArrival }) {
  return (
    String(visit.hostId) === String(hostId) &&
    visit.purpose === purpose &&
    new Date(visit.expectedArrival).getTime() === expectedArrival.getTime()
  );
}

async function replayResponse(res, user, existing, request) {
  if (!sameRequest(existing, request)) {
    return sendError(res, 409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used for a different registration');
  }
  const result = await visitService.findVisitDetails(existing._id, { includeContact: user.role !== 'host' });
  res.set('Idempotent-Replayed', 'true');
  return res.status(200).json(result);
}

async function createVisit(req, res, next) {
  try {
    const user = req.session.user;
    const body = req.body;
    const details = readVisitorDetails(body);

    const idempotency = readIdempotencyKey(req);
    if (idempotency.error) {
      return sendError(res, 400, 'VALIDATION_ERROR', idempotency.error);
    }

    if (body.visitorId !== undefined) {
      if (user.role === 'host') {
        return sendError(res, 403, 'FORBIDDEN', 'Only front-desk staff and admins can register an existing visitor record');
      }
      if (!isObjectId(body.visitorId)) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'visitorId must be a valid id');
      }
    }

    const visitorError = validateVisitorDetails(details, body.visitorId === undefined);
    if (visitorError) {
      return sendError(res, 400, 'VALIDATION_ERROR', visitorError);
    }

    const purposeError = validatePurpose(body.purpose, true);
    if (purposeError) {
      return sendError(res, 400, 'VALIDATION_ERROR', purposeError);
    }

    const arrival = parseArrival(body.expectedArrival, true);
    if (arrival.error) {
      return sendError(res, 400, 'VALIDATION_ERROR', arrival.error);
    }

    const host = await resolveHostId(user, body.hostId, true);
    if (host.status) {
      return sendError(res, host.status, host.code, host.message);
    }

    const request = { hostId: host.hostId, purpose: cleanText(body.purpose), expectedArrival: arrival.date };

    if (idempotency.key) {
      const existing = await findReplay(user, idempotency.key);
      if (existing) {
        return replayResponse(res, user, existing, request);
      }
    }

    let visitor;
    let recognition = { returning: false, matchedBy: null };
    if (body.visitorId !== undefined) {
      visitor = await visitorService.findVisitorById(body.visitorId);
      if (!visitor) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Visitor does not exist');
      }
      if (Object.keys(details).length > 0) {
        visitor = await registration.updateVisitorDetails(visitor._id, details);
      }
      recognition = { returning: true, matchedBy: 'visitorId' };
    } else {
      const resolved = await registration.resolveVisitor(details);
      visitor = resolved.visitor;
      recognition = { returning: resolved.returning, matchedBy: resolved.matchedBy };
    }

    try {
      await registration.assertNoDuplicateVisit({
        visitorId: visitor._id,
        hostId: host.hostId,
        expectedArrival: arrival.date
      });
    } catch (error) {
      // A retried request whose first attempt has just been saved is a replay, not a duplicate.
      const replay = idempotency.key && error.code === 'DUPLICATE_VISIT' ? await findReplay(user, idempotency.key) : null;
      if (replay) {
        return replayResponse(res, user, replay, request);
      }
      throw error;
    }

    let visit;
    try {
      visit = await visitService.createVisit({
        visitorId: visitor._id,
        ...request,
        createdBy: user._id,
        ...(idempotency.key ? { registrationKey: idempotency.key } : {})
      });
    } catch (error) {
      if (error.code === 11000 && idempotency.key) {
        const existing = await findReplay(user, idempotency.key);
        if (existing) {
          return replayResponse(res, user, existing, request);
        }
      }
      throw error;
    }

    logger.info('visit.registered', {
      requestId: req.id,
      visitId: String(visit._id),
      visitorId: String(visitor._id),
      hostId: String(host.hostId),
      by: user._id,
      returningVisitor: recognition.returning
    });

    const result = await visitService.findVisitDetails(visit._id, { includeContact: user.role !== 'host' });
    return res.status(201).json({ ...result, registration: recognition });
  } catch (error) {
    if (error instanceof registration.RegistrationError) {
      return sendRegistrationError(res, error);
    }
    return next(error);
  }
}

async function updateVisit(req, res, next) {
  try {
    const user = req.session.user;
    const body = req.body;

    const visit = await visitService.findVisitById(req.params.id);
    if (!visit) {
      return sendError(res, 404, 'VISIT_NOT_FOUND', 'Visit not found');
    }

    if (!canManageVisit(user, visit)) {
      return sendError(res, 403, 'FORBIDDEN', 'You can only edit your own visits');
    }

    if (visit.status !== 'Expected') {
      return sendError(res, 409, 'VISIT_NOT_EXPECTED', 'Only Expected visits can be edited');
    }

    const details = readVisitorDetails(body);
    const visitorError = validateVisitorDetails(details, false);
    if (visitorError) {
      return sendError(res, 400, 'VALIDATION_ERROR', visitorError);
    }

    if (user.role === 'host' && (details.email !== undefined || details.phone !== undefined)) {
      return sendError(res, 403, 'FORBIDDEN', 'Only front-desk staff and admins can change visitor contact details');
    }

    const purposeError = validatePurpose(body.purpose, false);
    if (purposeError) {
      return sendError(res, 400, 'VALIDATION_ERROR', purposeError);
    }

    const arrival = parseArrival(body.expectedArrival, false);
    if (arrival.error) {
      return sendError(res, 400, 'VALIDATION_ERROR', arrival.error);
    }

    const host = await resolveHostId(user, body.hostId, false);
    if (host.status) {
      return sendError(res, host.status, host.code, host.message);
    }

    const fields = {};
    if (body.purpose !== undefined) {
      fields.purpose = cleanText(body.purpose);
    }
    if (arrival.date) {
      fields.expectedArrival = arrival.date;
    }
    if (host.hostId) {
      fields.hostId = host.hostId;
    }

    if (fields.hostId || fields.expectedArrival) {
      await registration.assertNoDuplicateVisit({
        visitorId: visit.visitorId,
        hostId: fields.hostId || visit.hostId,
        expectedArrival: fields.expectedArrival || visit.expectedArrival,
        excludeVisitId: visit._id
      });
    }

    const changesVisitor = Object.keys(details).length > 0;
    if (changesVisitor) {
      if (user.role === 'host' && (await registration.visitorSharedWithOtherHosts(visit.visitorId, user._id))) {
        return sendError(
          res,
          403,
          'VISITOR_SHARED',
          'This visitor also visits other hosts; ask the front desk to change their details'
        );
      }
      await registration.assertContactAvailable(details, visit.visitorId);
    }

    const updated = await visitService.updateExpectedVisit(visit._id, fields);
    if (!updated) {
      return sendError(res, 409, 'VISIT_NOT_EXPECTED', 'Only Expected visits can be edited');
    }

    if (changesVisitor) {
      await registration.updateVisitorDetails(visit.visitorId, details);
    }

    logger.info('visit.updated', {
      requestId: req.id,
      visitId: String(visit._id),
      by: user._id,
      fields: [...Object.keys(fields), ...Object.keys(details)].join(',')
    });

    const result = await visitService.findVisitDetails(visit._id, { includeContact: user.role !== 'host' });
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof registration.RegistrationError) {
      return sendRegistrationError(res, error);
    }
    return next(error);
  }
}

async function cancelVisit(req, res, next) {
  try {
    const user = req.session.user;

    const visit = await visitService.findVisitById(req.params.id);
    if (!visit) {
      return sendError(res, 404, 'VISIT_NOT_FOUND', 'Visit not found');
    }

    if (!canManageVisit(user, visit)) {
      return sendError(res, 403, 'FORBIDDEN', 'You can only cancel your own visits');
    }

    const updated = await visitService.changeStatus(visit._id, 'Expected', {
      status: 'Cancelled',
      cancelledAt: new Date()
    });

    if (!updated) {
      return sendError(res, 409, 'VISIT_NOT_EXPECTED', 'Only Expected visits can be cancelled');
    }

    logger.info('visit.cancelled', { requestId: req.id, visitId: String(visit._id), by: user._id });

    const result = await visitService.findVisitDetails(visit._id, { includeContact: user.role !== 'host' });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = { createVisit, updateVisit, cancelVisit };
