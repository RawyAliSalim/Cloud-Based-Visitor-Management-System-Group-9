const mongoose = require('mongoose');

// Notification lifecycle:
//   Pending   -> being delivered for the first time
//   Sent      -> provider accepted it
//   Retrying  -> temporary failure, an automatic retry is scheduled at nextRetryAt
//   Failed    -> permanent failure or all attempts used; staff can resend
//   Cancelled -> retries stopped because they no longer make sense
//                (host already acknowledged, visitor left, or a manual resend replaced it)
const STATUSES = ['Pending', 'Sent', 'Retrying', 'Failed', 'Cancelled'];

const attemptSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    status: { type: String, enum: ['Sent', 'Failed'], required: true },
    error: { type: String, maxlength: 200 },
    retryable: { type: Boolean },
    durationMs: { type: Number }
  },
  { _id: false }
);

const notificationSchema = new mongoose.Schema(
  {
    visitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Visit', required: true },
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    channel: { type: String, enum: ['email', 'push'], required: true },
    kind: { type: String, enum: ['arrival'], default: 'arrival' },
    status: { type: String, enum: STATUSES, required: true, default: 'Pending' },
    sentAt: { type: Date },
    acknowledgedAt: { type: Date, default: null },
    acknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    error: { type: String, maxlength: 200 },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    lastAttemptAt: { type: Date },
    nextRetryAt: { type: Date, default: null },
    attemptLog: { type: [attemptSchema], default: [] },
    // Short lease so two retry workers never deliver the same notification at once.
    lockedUntil: { type: Date, default: null },
    resendOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Notification' },
    supersededBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Notification', default: null },
    // Set only on the first automatic notification per visit and channel, so the same
    // arrival can never be notified twice (a manual resend has no dedupeKey).
    dedupeKey: { type: String }
  },
  { timestamps: true }
);

notificationSchema.index({ hostId: 1, createdAt: -1 });
notificationSchema.index({ visitId: 1, createdAt: -1 });
notificationSchema.index({ status: 1, nextRetryAt: 1 });
notificationSchema.index(
  { dedupeKey: 1 },
  { name: 'dedupeKey_unique', unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } }
);

notificationSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
