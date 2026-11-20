const mongoose = require('mongoose');

const visitorSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    phone: { type: String, trim: true, maxlength: 20 },
    company: { type: String, trim: true, maxlength: 100 }
  },
  { timestamps: true }
);

visitorSchema.index({ fullName: 1 });
visitorSchema.index({ email: 1 });
visitorSchema.index({ phone: 1 });

module.exports = mongoose.models.Visitor || mongoose.model('Visitor', visitorSchema);
