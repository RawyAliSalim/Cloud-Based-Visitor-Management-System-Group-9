const mongoose = require('mongoose');

// Failed sign-in counters, one per email and one per IP address.
// Stored in MongoDB (not memory) so the limit also works on Vercel serverless functions.
const loginAttemptSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 },
  firstAt: { type: Date, required: true },
  lockedUntil: { type: Date, default: null },
  // MongoDB deletes the document automatically after this time (TTL index).
  expireAt: { type: Date, required: true }
});

loginAttemptSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.LoginAttempt || mongoose.model('LoginAttempt', loginAttemptSchema);
