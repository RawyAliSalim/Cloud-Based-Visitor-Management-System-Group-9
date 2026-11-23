const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const Visitor = require('../models/Visitor');
const Visit = require('../models/Visit');

const users = [
  { name: 'System Admin', email: 'admin@vms.local', role: 'admin' },
  { name: 'Front Desk', email: 'frontdesk@vms.local', role: 'front-desk' },
  { name: 'Host One', email: process.env.SEED_HOST_EMAIL || 'host1@vms.local', role: 'host' },
  { name: 'Host Two', email: 'host2@vms.local', role: 'host' }
];

async function upsertUser(user, passwordHash) {
  return User.findOneAndUpdate(
    { email: user.email.toLowerCase() },
    { $set: { name: user.name, role: user.role, active: true, passwordHash } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function seed() {
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error('Set SEED_PASSWORD (at least 8 characters) in .env before seeding');
  }

  await connectDB();

  // SEED_HOST_EMAIL gives Host One a real inbox (so arrival emails can be received).
  // An existing host1@vms.local account is moved to that address instead of creating a second Host One.
  const hostEmail = (process.env.SEED_HOST_EMAIL || '').trim().toLowerCase();
  if (hostEmail && hostEmail !== 'host1@vms.local') {
    const taken = await User.exists({ email: hostEmail });
    if (!taken) {
      const moved = await User.updateOne({ email: 'host1@vms.local' }, { $set: { email: hostEmail } });
      if (moved.modifiedCount) {
        console.log('Host One email changed to SEED_HOST_EMAIL');
      }
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const saved = [];
  for (const user of users) {
    saved.push(await upsertUser(user, passwordHash));
  }

  const frontDesk = saved.find((user) => user.role === 'front-desk');
  const host = saved.find((user) => user.role === 'host');

  const existingVisits = await Visit.countDocuments();
  if (existingVisits === 0) {
    const visitor = await Visitor.create({ fullName: 'Sara Ali', company: 'Demo Company' });
    await Visit.create({
      visitorId: visitor._id,
      hostId: host._id,
      purpose: 'Project meeting',
      expectedArrival: new Date(Date.now() + 60 * 60 * 1000),
      createdBy: frontDesk._id
    });
  }

  console.log('Seed complete. Users:');
  saved.forEach((user) => console.log(`- ${user.role}: ${user.email}`));
}

seed()
  .catch((error) => {
    console.error('Seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
