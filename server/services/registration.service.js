// Business rules of the Visitor Registration Service:
// - recognise returning visitors by email / phone instead of creating duplicates
// - refuse contact details that already belong to a different visitor record
// - refuse a second active visit for the same visitor and host around the same time
const Visitor = require('../models/Visitor');
const Visit = require('../models/Visit');
const logger = require('../utils/logger');

const ACTIVE_STATUSES = ['Expected', 'Checked-in'];

function duplicateWindowMs() {
  const minutes = Number(process.env.DUPLICATE_VISIT_WINDOW_MINUTES);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 120) * 60 * 1000;
}

class RegistrationError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function sameName(a, b) {
  const clean = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return clean(a) === clean(b);
}

async function findVisitorsByContact({ emailKey, phoneKey }, excludeId) {
  const or = [];
  if (emailKey) {
    // `email` covers visitor records created before emailKey existed.
    or.push({ emailKey }, { email: emailKey });
  }
  if (phoneKey) {
    or.push({ phoneKey });
  }
  if (or.length === 0) {
    return [];
  }
  const filter = { $or: or };
  if (excludeId) {
    filter._id = { $ne: excludeId };
  }
  return Visitor.find(filter).select('+emailKey +phoneKey').limit(5);
}

function contactConflict() {
  return new RegistrationError(
    409,
    'VISITOR_CONTACT_CONFLICT',
    'The email or phone number already belongs to another visitor record. Use the returning visitor lookup instead.'
  );
}

// Fields to $set / $unset on a visitor so that contact keys always match the stored contact details.
function buildVisitorUpdate(details) {
  const set = {};
  const unset = {};
  Object.entries(details).forEach(([field, value]) => {
    if (value === '' && field !== 'fullName') {
      unset[field] = '';
    } else {
      set[field] = value;
    }
  });
  const keys = Visitor.contactKeys(details);
  if (details.email !== undefined) {
    if (keys.emailKey) set.emailKey = keys.emailKey;
    else unset.emailKey = '';
  }
  if (details.phone !== undefined) {
    if (keys.phoneKey) set.phoneKey = keys.phoneKey;
    else unset.phoneKey = '';
  }
  const update = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(unset).length) update.$unset = unset;
  return update;
}

// Throws 409 when the email/phone in `details` is already used by a visitor other than `visitorId`.
async function assertContactAvailable(details, visitorId) {
  const others = await findVisitorsByContact(Visitor.contactKeys(details), visitorId);
  if (others.length > 0) {
    throw contactConflict();
  }
}

async function updateVisitorDetails(visitorId, details) {
  if (Object.keys(details).length === 0) {
    return Visitor.findById(visitorId);
  }
  await assertContactAvailable(details, visitorId);
  try {
    return await Visitor.findByIdAndUpdate(visitorId, buildVisitorUpdate(details), { new: true, runValidators: true });
  } catch (error) {
    if (error.code === 11000) {
      throw contactConflict();
    }
    throw error;
  }
}

// Returns { visitor, returning, matchedBy } for a registration that did not name an existing visitorId.
async function resolveVisitor(details, attempt = 0) {
  const keys = Visitor.contactKeys(details);
  const matches = await findVisitorsByContact(keys);
  const unique = [...new Map(matches.map((visitor) => [String(visitor._id), visitor])).values()];

  if (unique.length > 1) {
    throw contactConflict();
  }

  if (unique.length === 1) {
    const existing = unique[0];
    if (!sameName(existing.fullName, details.fullName)) {
      throw contactConflict();
    }

    const emailMatches = keys.emailKey && (existing.emailKey === keys.emailKey || existing.email === keys.emailKey);
    const matchedBy = emailMatches ? 'email' : 'phone';

    // Contact details given in this registration must not contradict the saved record.
    if (keys.emailKey && existing.email && existing.email !== keys.emailKey) {
      throw contactConflict();
    }
    if (keys.phoneKey && existing.phoneKey && existing.phoneKey !== keys.phoneKey) {
      throw contactConflict();
    }

    // Fill in details the saved record is missing; never overwrite saved values silently.
    const fill = {};
    ['email', 'phone', 'company'].forEach((field) => {
      if (details[field] && !existing[field]) {
        fill[field] = details[field];
      }
    });
    if (keys.emailKey && !existing.emailKey) {
      fill.email = existing.email || details.email;
    }
    const visitor = Object.keys(fill).length ? await updateVisitorDetails(existing._id, fill) : existing;
    logger.info('visitor.returning_recognised', { visitorId: String(existing._id), matchedBy });
    return { visitor, returning: true, matchedBy };
  }

  const fields = {};
  Object.entries(details).forEach(([field, value]) => {
    if (value !== '') {
      fields[field] = value;
    }
  });
  Object.entries(keys).forEach(([field, value]) => {
    if (value) {
      fields[field] = value;
    }
  });

  try {
    const visitor = await Visitor.create(fields);
    return { visitor, returning: false, matchedBy: null };
  } catch (error) {
    // Another request created the same visitor a moment ago: use that record instead.
    if (error.code === 11000 && attempt === 0) {
      return resolveVisitor(details, 1);
    }
    if (error.code === 11000) {
      throw contactConflict();
    }
    throw error;
  }
}

async function findDuplicateVisit({ visitorId, hostId, expectedArrival, excludeVisitId }) {
  const windowMs = duplicateWindowMs();
  const time = new Date(expectedArrival).getTime();
  const filter = {
    visitorId,
    hostId,
    status: { $in: ACTIVE_STATUSES },
    expectedArrival: { $gte: new Date(time - windowMs), $lte: new Date(time + windowMs) }
  };
  if (excludeVisitId) {
    filter._id = { $ne: excludeVisitId };
  }
  return Visit.findOne(filter).select('_id status expectedArrival').lean();
}

async function assertNoDuplicateVisit(params) {
  const duplicate = await findDuplicateVisit(params);
  if (duplicate) {
    throw new RegistrationError(
      409,
      'DUPLICATE_VISIT',
      'This visitor already has an active visit with the same host around that time',
      { visitId: String(duplicate._id), status: duplicate.status }
    );
  }
}

// Hosts may only change a visitor's shared details if no other host has visits with that visitor.
async function visitorSharedWithOtherHosts(visitorId, hostId) {
  return Boolean(await Visit.exists({ visitorId, hostId: { $ne: hostId } }));
}

module.exports = {
  RegistrationError,
  resolveVisitor,
  updateVisitorDetails,
  assertContactAvailable,
  assertNoDuplicateVisit,
  findDuplicateVisit,
  visitorSharedWithOtherHosts
};
