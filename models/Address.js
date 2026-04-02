const mongoose = require("mongoose");

const addressSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },

  type: String,

  house: String,
  street: String,
  landmark: String,
  city: String,
  state: String,
  pincode: String,

  fullAddress: String,

  latitude: Number,
  longitude: Number,

  // ⭐ NEW
  isDefault: {
    type: Boolean,
    default: false
  }

}, { timestamps: true });

module.exports = mongoose.model("Address", addressSchema);