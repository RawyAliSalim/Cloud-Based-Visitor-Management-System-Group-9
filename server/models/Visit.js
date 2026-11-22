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
    checkedInBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    checkedOutBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Append-only record of every status change, so the visit history cannot silently drift.
    statusHistory: {
      type: [
        {
          _id: false,
          from: { type: String, default: null },
          to: { type: String, required: true },
          at: { type: Date, required: true },
          by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
        }
      ],
      default: []
    },
    cancelledAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

// Allowed status changes. Anything else is an invalid transition.
visitSchema.statics.TRANSITIONS = Object.freeze({
  Expected: ['Checked-in', 'Cancelled'],
  'Checked-in': ['Checked-out'],
  'Checked-out': [],
  Cancelled: []
});

visitSchema.pre('save', function recordCreation(next) {
  if (this.isNew && this.statusHistory.length === 0) {
    this.statusHistory.push({ from: null, to: this.status, at: this.createdAt || new Date(), by: this.createdBy });
  }
  next();
});

visitSchema.index({ checkInTime: -1 });
visitSchema.index({ status: 1, expectedArrival: -1 });
visitSchema.index({ hostId: 1, expectedArrival: -1 });
visitSchema.index({ visitorId: 1 });

module.exports = mongoose.models.Visit || mongoose.model('Visit', visitSchema);
