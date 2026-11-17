const visitService = require('../services/visit.service');
const visitorService = require('../services/visitor.service');
const userService = require('../services/user.service');
const { sendError, isObjectId, isEmail, isPhone } = require('../middleware/validate');

const PAST_GRACE_MS = 5 * 60 * 1000;
const VISITOR_FIELDS = ['fullName', 'email', 'phone', 'company'];

function readVisitorDetails(body) {
  const details = {};
  VISITOR_FIELDS.forEach((field) => {
    if (body[field] !== undefined) {
      details[field] = typeof body[field] === 'string' ? body[field].trim() : body[field];
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
  if (details.fullName !== undefined && (details.fullName.length < 2 || details.fullName.length > 100)) {
    return 'fullName must be 2 to 100 characters';
  }
  if (details.email && !isEmail(details.email)) {
    return 'email is not valid';
  }
  if (details.phone && !isPhone(details.phone)) {
    return 'phone is not valid';
  }
  if (details.company !== undefined && details.company.length > 100) {
    return 'company must be at most 100 characters';
  }
  return null;
}

function validatePurpose(purpose, required) {
  if (purpose === undefined) {
    return required ? 'purpose is required' : null;
  }
  if (typeof purpose !== 'string' || !purpose.trim() || purpose.trim().length > 200) {
    return 'purpose must be 1 to 200 characters';
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

async function createVisit(req, res, next) {
  try {
    const user = req.session.user;
    const body = req.body;
    const details = readVisitorDetails(body);

    if (body.visitorId !== undefined && !isObjectId(body.visitorId)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'visitorId must be a valid id');
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

    let visitor;
    if (body.visitorId !== undefined) {
      visitor = await visitorService.findVisitorById(body.visitorId);
      if (!visitor) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Visitor does not exist');
      }
      if (Object.keys(details).length > 0) {
        visitor = await visitorService.updateVisitor(visitor._id, details);
      }
    } else {
      visitor = await visitorService.createVisitor(details);
    }

    const visit = await visitService.createVisit({
      visitorId: visitor._id,
      hostId: host.hostId,
      purpose: body.purpose.trim(),
      expectedArrival: arrival.date,
      createdBy: user._id
    });

    const result = await visitService.findVisitDetails(visit._id, { includeContact: user.role !== 'host' });
    return res.status(201).json(result);
  } catch (error) {
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
      fields.purpose = body.purpose.trim();
    }
    if (arrival.date) {
      fields.expectedArrival = arrival.date;
    }
    if (host.hostId) {
      fields.hostId = host.hostId;
    }

    const updated = await visitService.updateExpectedVisit(visit._id, fields);
    if (!updated) {
      return sendError(res, 409, 'VISIT_NOT_EXPECTED', 'Only Expected visits can be edited');
    }

    if (Object.keys(details).length > 0) {
      await visitorService.updateVisitor(visit.visitorId, details);
    }

    const result = await visitService.findVisitDetails(visit._id, { includeContact: user.role !== 'host' });
    return res.status(200).json(result);
  } catch (error) {
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

    const result = await visitService.findVisitDetails(visit._id, { includeContact: user.role !== 'host' });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = { createVisit, updateVisit, cancelVisit };
