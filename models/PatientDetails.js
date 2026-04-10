const mongoose = require("mongoose");

const patientDetailsSchema = new mongoose.Schema(
{
  userId: {
    type: String,
    required: true,
    index: true
  },

  patientId: {
    type: String,
    unique: true,
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
    validate: {
      validator: function(v) {
        return !v || /^[0-9]{10}$/.test(v);
      },
      message: "Invalid secondary phone number"
    }
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

  isActive: {
  type: Boolean,
  default: true
},
  addressId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "Address"
},

  isDefault: {
    type: Boolean,
    default: false
  },
  
isDeleted: {
  type: Boolean,
  default: false
}
},
{ timestamps: true }
);

// ✅ AUTO GENERATE PATIENT ID (CORRECT PLACE)
patientDetailsSchema.pre("save", async function () {
  if (!this.patientId) {

    const lastPatient = await this.constructor
      .findOne({ patientId: { $exists: true } }) // important fix
      .sort({ createdAt: -1 });

    let nextNumber = 1;

    if (lastPatient && lastPatient.patientId) {
      const num = parseInt(lastPatient.patientId.replace("P", ""));
      nextNumber = num + 1;
    }

    this.patientId = "P" + String(nextNumber).padStart(3, "0");
  }
});

module.exports = mongoose.model("PatientDetails", patientDetailsSchema);