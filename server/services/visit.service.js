const Visit = require('../models/Visit');
const { findVisitorIdsByName } = require('./visitor.service');

const LIST_LIMIT = 200;
const PUBLIC_VISITOR_FIELDS = 'fullName company';
const FULL_VISITOR_FIELDS = 'fullName company email phone';
const DATE_FIELDS = { expected: 'expectedArrival', checkIn: 'checkInTime', checkOut: 'checkOutTime' };

function overstayMinutes() {
  const hours = Number(process.env.OVERSTAY_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : 8) * 60;
}

function minutesBetween(start, end) {
  if (!start) {
    return null;
  }
  return Math.max(0, Math.round((new Date(end || Date.now()).getTime() - new Date(start).getTime()) / 60000));
}

// Adds derived, read-only fields used by the visitor log and the on-site board.
function withDurations(visit) {
  if (!visit) {
    return visit;
  }
  const result = { ...visit };
  if (visit.checkInTime) {
    result.durationMinutes = minutesBetween(visit.checkInTime, visit.checkOutTime);
  }
  if (visit.status === 'Checked-in') {
    result.overstay = result.durationMinutes > overstayMinutes();
  }
  return result;
}

function isValidTransition(from, to) {
  return (Visit.TRANSITIONS[from] || []).includes(to);
}

async function createVisit(data) {
  return Visit.create(data);
}

async function findVisitById(id) {
  return Visit.findById(id);
}

async function findVisitDetails(id, { includeContact }) {
  const visit = await Visit.findById(id)
    .populate('visitorId', includeContact ? FULL_VISITOR_FIELDS : PUBLIC_VISITOR_FIELDS)
    .populate('hostId', 'name')
    .populate('createdBy', 'name')
    .populate('checkedInBy', 'name')
    .populate('checkedOutBy', 'name')
    .populate('statusHistory.by', 'name')
    .lean();
  return withDurations(visit);
}

async function updateExpectedVisit(id, fields) {
  return Visit.findOneAndUpdate(
    { _id: id, status: 'Expected' },
    { $set: fields },
    { new: true, runValidators: true }
  );
}

// Atomic status change: only succeeds if the visit is still in `fromStatus`, so two
// concurrent check-ins (or a check-in racing a cancel) cannot both win.
async function changeStatus(id, fromStatus, fields, actorId = null) {
  if (!isValidTransition(fromStatus, fields.status)) {
    throw new Error(`Invalid visit transition ${fromStatus} -> ${fields.status}`);
  }
  const at = fields.checkInTime || fields.checkOutTime || fields.cancelledAt || new Date();
  return Visit.findOneAndUpdate(
    { _id: id, status: fromStatus },
    {
      $set: fields,
      $push: { statusHistory: { from: fromStatus, to: fields.status, at, by: actorId } }
    },
    { new: true }
  );
}

async function findOtherVisitOnSite(visitorId, excludeVisitId) {
  return Visit.findOne({ visitorId, status: 'Checked-in', _id: { $ne: excludeVisitId } })
    .select('_id hostId checkInTime')
    .lean();
}

async function listVisits({ status, hostId, visitorName, from, to, dateField }) {
  const filter = {};

  if (status) {
    filter.status = status;
  }

  if (hostId) {
    filter.hostId = hostId;
  }

  if (from || to) {
    const field = DATE_FIELDS[dateField] || DATE_FIELDS.expected;
    filter[field] = {};
    if (from) {
      filter[field].$gte = from;
    }
    if (to) {
      filter[field].$lte = to;
    }
  }

  if (visitorName) {
    filter.visitorId = { $in: await findVisitorIdsByName(visitorName) };
  }

  const visits = await Visit.find(filter)
    .sort({ expectedArrival: -1 })
    .limit(LIST_LIMIT)
    .select('-statusHistory')
    .populate('visitorId', PUBLIC_VISITOR_FIELDS)
    .populate('hostId', 'name')
    .lean();
  return visits.map(withDurations);
}

async function listOnSiteVisits() {
  const visits = await Visit.find({ status: 'Checked-in' })
    .sort({ checkInTime: -1 })
    .select('-statusHistory')
    .populate('visitorId', PUBLIC_VISITOR_FIELDS)
    .populate('hostId', 'name')
    .lean();
  return visits.map(withDurations);
}

module.exports = {
  createVisit,
  findVisitById,
  findVisitDetails,
  updateExpectedVisit,
  changeStatus,
  isValidTransition,
  findOtherVisitOnSite,
  listVisits,
  listOnSiteVisits,
  overstayMinutes,
  DATE_FIELDS
};
