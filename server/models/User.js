const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['front-desk', 'host', 'admin'], required: true },
    active: { type: Boolean, default: true },
    fcmTokens: { type: [String], default: [] }
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.passwordHash;
        delete ret.fcmTokens;
        return ret;
      }
    }
  }
);

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
