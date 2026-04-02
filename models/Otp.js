const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true
  },

  otp: {
    type: String,
    required: true
  },

  expiresAt: {
    type: Date,
    required: true
  }

}, { timestamps: true });

/* ── INDEXES ── */
otpSchema.index({ phone: 1 });
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL: auto-delete expired OTPs

module.exports = mongoose.model("Otp", otpSchema);