const mongoose = require('mongoose');

const visitSchema = new mongoose.Schema(
  {
    visitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Visitor', required: true },
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    purpose: { type: String, required: true, trim: true, maxlength: 200 },
    expectedArrival: { type: Date, required: true },
    status: {
      type: String,
      enum: ['Expected', 'Checked-in', 'Checked-out', 'Cancelled'],
      default: 'Expected',
      required: true
    },
    checkInTime: { type: Date },
    checkOutTime: { type: Date },
    cancelledAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Client-generated Idempotency-Key, so a double-submitted registration creates one visit.
    registrationKey: { type: String, maxlength: 100, select: false }
  },
  { timestamps: true }
);

visitSchema.index({ status: 1, expectedArrival: -1 });
visitSchema.index({ hostId: 1, expectedArrival: -1 });
visitSchema.index({ visitorId: 1 });
visitSchema.index(
  { createdBy: 1, registrationKey: 1 },
  { name: 'registrationKey_unique', unique: true, partialFilterExpression: { registrationKey: { $type: 'string' } } }
);

module.exports = mongoose.models.Visit || mongoose.model('Visit', visitSchema);
