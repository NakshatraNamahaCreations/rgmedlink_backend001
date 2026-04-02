const mongoose = require("mongoose");

const patientDetailsSchema = new mongoose.Schema(
{
  userId: {
    type: String,
    required: true,
    index: true
  },

  name: {
    type: String,
    required: true,
    trim: true
  },

  age: Number,

  email: {
    type: String,
    trim: true,
    lowercase: true
  },

  primaryPhone: {
    type: String,
    required: true,
    match: [/^[0-9]{10}$/, "Invalid phone number"]
  },

  secondaryPhone: {
    type: String,
    default: ""
  },

  gender: {
    type: String,
    enum: ["Male", "Female", "Other"]
  },

  orderingFor: {
    type: String,
    enum: ["myself", "someone"],
    default: "myself"
  },

  // ⭐ NEW
  isDefault: {
    type: Boolean,
    default: false
  }

},
{ timestamps: true }
);

module.exports = mongoose.model("PatientDetails", patientDetailsSchema);