const mongoose = require("mongoose");

const medSchema = new mongoose.Schema({
  medicine: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Medicine",
    required: true,
  },
  duration: { type: Number, required: true },
  freq: {
    m: { type: Number, default: 0 },
    a: { type: Number, default: 0 },
    n: { type: Number, default: 0 },
  },
  qty: Number,
  price: Number,
  subtotal: Number,
});

const prescriptionSchema = new mongoose.Schema(
  {
    rxId: { type: String, unique: true },

    doctor: String,
    start: Date,
    expiry: Date,
    subtotal: Number,
    gst: Number,
    discount: { type: Number, default: 0 },
    total: Number,
    payStatus: {
      type: String,
      enum: ["Unpaid", "Paid"],
      default: "Unpaid",
    },
    orderStatus: {
      type: String,
      enum: ["Pending", "Processing", "Packed", "Shipped", "Delivered"],
      default: "Pending",
    },
    meds: [medSchema],
  },
  { timestamps: true }
);

/* ── INDEXES for fast queries at scale ── */

prescriptionSchema.index({ payStatus: 1, orderStatus: 1 });
prescriptionSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Prescription", prescriptionSchema);