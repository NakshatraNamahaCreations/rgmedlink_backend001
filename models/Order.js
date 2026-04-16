const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
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
      default: "Pending",
    },

    invoiceDate: Date,

    userId: {
      type: String,
      required: true,
      index: true,
    },

    prescription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Prescription",
    },

    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PatientDetails",
    },

    // ✅ SNAPSHOT (IMMUTABLE DATA)
    patientDetails: {
      patientId: String,
      name: String,
      phone: String,
      secondaryPhone: String,
      gender: String,
      orderingFor: String,
    },

    addressDetails: {
      fullAddress: String,
      city: String,
      state: String,
      pincode: String,
    },

    totalAmount: {
      type: Number,
      required: true,
    },

    // 🔥 ITEMS
    items: [
      {
        medicineId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Medicine",
          required: true,
        },

        name: {
          type: String,
          required: true,
        },

        qty: {
          type: Number,
          required: true,
        },

        duration: {
          type: Number,
          default: 0,
        },

        freq: {
          m: { type: Number, default: 0 },
          a: { type: Number, default: 0 },
          n: { type: Number, default: 0 },
        },

        price: {
          type: Number,
          required: true,
        },

        unit: {
          type: String,
          default: "tablet",
        },

        subtotal: {
          type: Number,
          default: 0,
        },
      },
    ],

    // 🔥 RAZORPAY DETAILS
    razorpayOrderId: {
      type: String,
      index: true, // ✅ faster search
    },

    razorpayPaymentId: {
      type: String,
      index: true,
    },

    razorpaySignature: {
      type: String,
    },

    // 🔥 PAYMENT STATUS
    paymentStatus: {
      type: String,
      enum: ["Pending", "Paid", "Failed"],
      default: "Pending",
      index: true,
    },

    paymentDate: Date,

    // 🔥 ORDER STATUS
    orderStatus: {
      type: String,
      enum: ["Created", "Processing", "Packed", "Shipped", "Delivered"],
      default: "Created",
      index: true,
    },
    orderSource: {
    type: String,
    enum: ["admin", "mobile"],
    default: "mobile"
    },
    isDeleted: {
      type: Boolean,
      default: false
    },
    deliveryAddress: {
      type: String,
      default: "",
    },

    deliveredAt: Date,
  },
  { timestamps: true }
);

/* ── INDEXES ── */
orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ paymentStatus: 1, createdAt: -1 });
orderSchema.index({ prescription: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ "patientDetails.name": 1 });

/* ── AUTO GENERATE IDS ── */
orderSchema.pre("save", function () {
  if (!this.orderId) {
    this.orderId = "ORD-" + Date.now();
  }

  if (!this.invoiceNumber) {
    this.invoiceNumber = "INV-" + Date.now();
  }
});

module.exports = mongoose.model("Order", orderSchema);