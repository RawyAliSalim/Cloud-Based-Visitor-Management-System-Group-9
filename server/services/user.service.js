const User = require('../models/User');

async function findByEmailWithPassword(email) {
  return User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
}

async function listActiveHosts() {
  return User.find({ role: 'host', active: true }).select('name').sort({ name: 1 }).lean();
}

async function findActiveHost(id) {
  return User.findOne({ _id: id, role: 'host', active: true }).select('name');
}

module.exports = { findByEmailWithPassword, listActiveHosts, findActiveHost };
