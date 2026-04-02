const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    unique: true,
  },

  invoiceNumber: {
    type: String,
    unique: true,
  },

  invoiceStatus: {
    type: String,
    enum: ["Pending", "Generated"],
    default: "Pending"
  },

  invoiceDate: Date,

  userId: {
    type: String,
    required: true,
    index: true
  },

  prescription: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Prescription",
    required: false,
  },

  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "PatientDetails",
  },

  // ✅ FIXED SNAPSHOT
  patientDetails: {
    name: String,
    phone: String,
    secondaryPhone: String,   // ✅ FIX
    gender: String,
    orderingFor: String       // ✅ FIX
  },

  addressDetails: {
    fullAddress: String,
    city: String,
    state: String,
    pincode: String
  },

  totalAmount: {
    type: Number,
    required: true,
  },

  paymentStatus: {
    type: String,
    enum: ["Pending", "Paid", "Failed"],
    default: "Pending",
  },

  orderStatus: {
    type: String,
    enum: ["Created", "Processing", "Packed", "Shipped", "Delivered"],
    default: "Created",
  },

  deliveryAddress: {
    type: String,
    default: "",
  },

  deliveredAt: Date

}, { timestamps: true });


/* ── INDEXES for fast queries at scale ── */
orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ paymentStatus: 1, createdAt: -1 });
orderSchema.index({ prescription: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ "patientDetails.name": 1 });

// ✅ AUTO GENERATE IDs
orderSchema.pre("save", function () {
  if (!this.orderId) {
    this.orderId = "ORD-" + Date.now();
  }

  if (!this.invoiceNumber) {
    this.invoiceNumber = "INV-" + Date.now();
  }
});

module.exports = mongoose.model("Order", orderSchema);