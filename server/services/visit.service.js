const Visit = require('../models/Visit');
const { findVisitorIdsByName } = require('./visitor.service');

const LIST_LIMIT = 200;
const PUBLIC_VISITOR_FIELDS = 'fullName company';
const FULL_VISITOR_FIELDS = 'fullName company email phone';

async function createVisit(data) {
  return Visit.create(data);
}

async function findVisitById(id) {
  return Visit.findById(id);
}

async function findVisitDetails(id, { includeContact }) {
  return Visit.findById(id)
    .populate('visitorId', includeContact ? FULL_VISITOR_FIELDS : PUBLIC_VISITOR_FIELDS)
    .populate('hostId', 'name')
    .populate('createdBy', 'name')
    .lean();
}

async function updateExpectedVisit(id, fields) {
  return Visit.findOneAndUpdate(
    { _id: id, status: 'Expected' },
    { $set: fields },
    { new: true, runValidators: true }
  );
}

async function changeStatus(id, fromStatus, fields) {
  return Visit.findOneAndUpdate({ _id: id, status: fromStatus }, { $set: fields }, { new: true });
}

async function listVisits({ status, hostId, visitorName, from, to }) {
  const filter = {};

  if (status) {
    filter.status = status;
  }

  if (hostId) {
    filter.hostId = hostId;
  }

  if (from || to) {
    filter.expectedArrival = {};
    if (from) {
      filter.expectedArrival.$gte = from;
    }
    if (to) {
      filter.expectedArrival.$lte = to;
    }
  }

  if (visitorName) {
    filter.visitorId = { $in: await findVisitorIdsByName(visitorName) };
  }

  return Visit.find(filter)
    .sort({ expectedArrival: -1 })
    .limit(LIST_LIMIT)
    .populate('visitorId', PUBLIC_VISITOR_FIELDS)
    .populate('hostId', 'name')
    .lean();
}

async function listOnSiteVisits() {
  return Visit.find({ status: 'Checked-in' })
    .sort({ checkInTime: -1 })
    .populate('visitorId', PUBLIC_VISITOR_FIELDS)
    .populate('hostId', 'name')
    .lean();
}

module.exports = {
  createVisit,
  findVisitById,
  findVisitDetails,
  updateExpectedVisit,
  changeStatus,
  listVisits,
  listOnSiteVisits
};
