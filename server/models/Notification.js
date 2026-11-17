const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    visitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Visit', required: true },
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    channel: { type: String, enum: ['email', 'push'], required: true },
    status: { type: String, enum: ['Sent', 'Failed'], required: true },
    sentAt: { type: Date },
    acknowledgedAt: { type: Date, default: null },
    error: { type: String, maxlength: 200 },
    resendOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Notification' }
  },
  { timestamps: true }
);

notificationSchema.index({ hostId: 1, createdAt: -1 });
notificationSchema.index({ visitId: 1, createdAt: -1 });

module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
