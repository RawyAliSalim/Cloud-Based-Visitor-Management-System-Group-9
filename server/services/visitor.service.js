const Visitor = require('../models/Visitor');
const Visit = require('../models/Visit');

const SEARCH_LIMIT = 20;
const PROFILE_VISIT_LIMIT = 20;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Visit counts per visitor, so the front desk can tell returning visitors apart.
async function visitStats(visitorIds) {
  if (visitorIds.length === 0) {
    return new Map();
  }
  const rows = await Visit.aggregate([
    { $match: { visitorId: { $in: visitorIds } } },
    {
      $group: {
        _id: '$visitorId',
        visitCount: { $sum: 1 },
        completedVisits: { $sum: { $cond: [{ $eq: ['$status', 'Checked-out'] }, 1, 0] } },
        activeVisits: { $sum: { $cond: [{ $in: ['$status', ['Expected', 'Checked-in']] }, 1, 0] } },
        lastVisitAt: { $max: '$expectedArrival' }
      }
    }
  ]);
  return new Map(rows.map((row) => [String(row._id), row]));
}

function withStats(visitor, stats) {
  const row = stats.get(String(visitor._id));
  return {
    ...visitor,
    visitCount: row ? row.visitCount : 0,
    completedVisits: row ? row.completedVisits : 0,
    activeVisits: row ? row.activeVisits : 0,
    lastVisitAt: row ? row.lastVisitAt : null,
    returningVisitor: Boolean(row && row.completedVisits > 0)
  };
}

async function searchVisitors(term) {
  const pattern = new RegExp(escapeRegex(term), 'i');
  const digits = term.replace(/\D/g, '');
  const or = [{ fullName: pattern }, { email: pattern }, { phone: pattern }];
  if (digits.length >= 4) {
    // Lets "010 1234" find a visitor saved as "+20 101 234 ...".
    or.push({ phoneKey: new RegExp(escapeRegex(digits)) });
  }
  const visitors = await Visitor.find({ $or: or }).sort({ updatedAt: -1 }).limit(SEARCH_LIMIT).lean();
  const stats = await visitStats(visitors.map((visitor) => visitor._id));
  return visitors.map((visitor) => withStats(visitor, stats));
}

async function getVisitorProfile(id) {
  const visitor = await Visitor.findById(id).lean();
  if (!visitor) {
    return null;
  }
  const [stats, visits] = await Promise.all([
    visitStats([visitor._id]),
    Visit.find({ visitorId: visitor._id })
      .sort({ expectedArrival: -1 })
      .limit(PROFILE_VISIT_LIMIT)
      .populate('hostId', 'name')
      .select('hostId purpose status expectedArrival checkInTime checkOutTime cancelledAt')
      .lean()
  ]);
  return { ...withStats(visitor, stats), visits };
}

async function findVisitorIdsByName(name) {
  const pattern = new RegExp(escapeRegex(name), 'i');
  const visitors = await Visitor.find({ fullName: pattern }).select('_id').limit(500).lean();
  return visitors.map((visitor) => visitor._id);
}

async function findVisitorById(id) {
  return Visitor.findById(id);
}

async function createVisitor(details) {
  return Visitor.create({ ...details, ...Visitor.contactKeys(details) });
}

async function updateVisitor(id, details) {
  return Visitor.findByIdAndUpdate(id, { $set: details }, { new: true, runValidators: true });
}

module.exports = {
  searchVisitors,
  getVisitorProfile,
  findVisitorIdsByName,
  findVisitorById,
  createVisitor,
  updateVisitor
};
