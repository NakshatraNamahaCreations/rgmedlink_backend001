const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { generateToken } = require("../middleware/auth");

// In-memory OTP store with expiry and attempts
const otpStore = {};
const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 5;
const IS_DEV = process.env.NODE_ENV !== "production";

// Rate limiting: 5 OTP requests per IP per 10 minutes
const otpSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { success: false, message: "Too many OTP requests. Please try again in 10 minutes." },
  validate: false,
});

// Rate limiting: 10 verify attempts per IP per 10 minutes
const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { success: false, message: "Too many attempts. Please try again later." },
  validate: false,
});

/* SEND OTP */
router.post("/send", otpSendLimiter, (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ success: false, message: "Phone number required" });
  }

  if (!/^\d{10}$/.test(phone)) {
    return res.status(400).json({ success: false, message: "Invalid phone number. Must be 10 digits." });
  }

  const otp = Math.floor(1000 + Math.random() * 9000).toString();

  otpStore[phone] = {
    otp,
    createdAt: Date.now(),
    attempts: 0,
  };

  console.log("OTP for", phone, ":", otp);

  // TODO: In production, send via SMS (Twilio/MSG91) and remove otp from response
  const response = { success: true, message: "OTP sent successfully", otp };
  if (IS_DEV) response.otp = otp; // Only in dev mode

  res.json(response);
});

/* VERIFY OTP */
router.post("/verify", otpVerifyLimiter, (req, res) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    return res.status(400).json({ success: false, message: "Phone and OTP required" });
  }

  const stored = otpStore[phone];

  if (!stored) {
    return res.status(400).json({ success: false, message: "OTP expired or not sent. Please request a new OTP." });
  }

  // Check expiry
  if (Date.now() - stored.createdAt > OTP_EXPIRY_MS) {
    delete otpStore[phone];
    return res.status(400).json({ success: false, message: "OTP expired. Please request a new one." });
  }

  // Check max attempts
  stored.attempts++;
  if (stored.attempts > MAX_ATTEMPTS) {
    delete otpStore[phone];
    return res.status(400).json({ success: false, message: "Too many wrong attempts. Please request a new OTP." });
  }

  if (stored.otp !== otp) {
    return res.status(400).json({
      success: false,
      message: `Invalid OTP. ${MAX_ATTEMPTS - stored.attempts} attempts remaining.`,
    });
  }

  // Success — clean up and generate token
  delete otpStore[phone];

  const token = generateToken({ phone, userId: phone });

  res.json({
    success: true,
    message: "OTP verified successfully",
    token,
    userId: phone,
    name: "Patient",
  });
});

// Cleanup expired OTPs every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const phone in otpStore) {
    if (now - otpStore[phone].createdAt > OTP_EXPIRY_MS) {
      delete otpStore[phone];
    }
  }
}, 5 * 60 * 1000);

module.exports = router;
