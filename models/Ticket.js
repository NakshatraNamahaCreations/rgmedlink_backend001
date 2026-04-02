const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  sender: {
    type: String,
    enum: ["Customer", "Admin"],
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
}, { _id: true });

const ticketSchema = new mongoose.Schema({
  ticketId: {
    type: String,
    unique: true,
    index: true,
  },

  userId: {
    type: String,
  },

  customerName: {
    type: String,
    required: true,
  },

  customerPhone: {
    type: String,
  },

  customerEmail: {
    type: String,
  },

  subject: {
    type: String,
    required: true,
  },

  category: {
    type: String,
    enum: ["Order Issue", "Payment Issue", "Delivery Issue", "Medicine Query", "Account Issue", "General"],
    default: "General",
  },

  priority: {
    type: String,
    enum: ["Low", "Medium", "High", "Urgent"],
    default: "Medium",
  },

  status: {
    type: String,
    enum: ["Open", "In Progress", "Resolved", "Closed"],
    default: "Open",
  },

  description: {
    type: String,
    required: true,
  },

  orderId: {
    type: String,
  },

  assignedTo: {
    type: String,
    default: "",
  },

  messages: [messageSchema],

  resolvedAt: Date,

}, { timestamps: true });


/* ── INDEXES for fast queries at scale ── */
ticketSchema.index({ status: 1, createdAt: -1 });
ticketSchema.index({ priority: 1 });
ticketSchema.index({ category: 1 });
ticketSchema.index({ userId: 1 });
ticketSchema.index({ createdAt: -1 });

// Auto-generate ticketId
ticketSchema.pre("save", function () {
  if (!this.ticketId) {
    this.ticketId = "TKT-" + Date.now();
  }
});

module.exports = mongoose.model("Ticket", ticketSchema);
