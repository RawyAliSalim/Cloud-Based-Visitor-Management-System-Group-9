const mongoose = require('mongoose');

const visitorSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    phone: { type: String, trim: true, maxlength: 20 },
    company: { type: String, trim: true, maxlength: 100 },
    // Normalised contact keys used to recognise returning visitors and to stop
    // two visitor records sharing the same email or phone number.
    emailKey: { type: String, select: false },
    phoneKey: { type: String, select: false }
  },
  { timestamps: true }
);

visitorSchema.index({ fullName: 1 });
visitorSchema.index({ email: 1 });
visitorSchema.index({ phone: 1 });
visitorSchema.index(
  { emailKey: 1 },
  { name: 'emailKey_unique', unique: true, partialFilterExpression: { emailKey: { $type: 'string' } } }
);
visitorSchema.index(
  { phoneKey: 1 },
  { name: 'phoneKey_unique', unique: true, partialFilterExpression: { phoneKey: { $type: 'string' } } }
);

function normalizePhone(phone) {
  if (typeof phone !== 'string' || !phone.trim()) {
    return null;
  }
  const digits = phone.replace(/\D/g, '');
  return phone.trim().startsWith('+') ? `+${digits}` : digits;
}

function normalizeEmail(email) {
  return typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
}

visitorSchema.statics.contactKeys = function contactKeys(details) {
  return { emailKey: normalizeEmail(details.email), phoneKey: normalizePhone(details.phone) };
};

module.exports = mongoose.models.Visitor || mongoose.model('Visitor', visitorSchema);
