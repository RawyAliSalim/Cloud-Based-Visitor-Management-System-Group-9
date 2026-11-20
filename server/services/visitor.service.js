const Visitor = require('../models/Visitor');

const SEARCH_LIMIT = 20;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function searchVisitors(term) {
  const pattern = new RegExp(escapeRegex(term), 'i');
  return Visitor.find({ $or: [{ fullName: pattern }, { email: pattern }, { phone: pattern }] })
    .sort({ updatedAt: -1 })
    .limit(SEARCH_LIMIT)
    .lean();
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
  return Visitor.create(details);
}

async function updateVisitor(id, details) {
  return Visitor.findByIdAndUpdate(id, { $set: details }, { new: true, runValidators: true });
}

module.exports = { searchVisitors, findVisitorIdsByName, findVisitorById, createVisitor, updateVisitor };
