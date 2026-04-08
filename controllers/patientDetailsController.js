const PatientDetails = require("../models/PatientDetails");
const Address = require("../models/Address");

exports.createPatientDetails = async (req, res) => {
  try {
    const {
      userId,
      name,
      primaryPhone,
      secondaryPhone,
      fullAddress,
      city,
      state,
      pincode
    } = req.body;

    // ✅ Required validation
    if (!userId || !name || !primaryPhone) {
      return res.status(400).json({
        success: false,
        message: "userId, name and primaryPhone are required"
      });
    }

    // ✅ Phone validation
    const phoneRegex = /^[0-9]{10}$/;

    if (!phoneRegex.test(primaryPhone)) {
      return res.status(400).json({
        success: false,
        message: "Invalid primary phone number"
      });
    }

    if (secondaryPhone && !phoneRegex.test(secondaryPhone)) {
      return res.status(400).json({
        success: false,
        message: "Invalid secondary phone number"
      });
    }

    // ✅ Prevent duplicate patient
    const existingPatient = await PatientDetails.findOne({
      primaryPhone,
      userId,
      isDeleted: false
    });

    if (existingPatient) {
      return res.status(200).json({
        success: true,
        message: "Patient already exists",
        data: existingPatient
      });
    }

    // ✅ First patient auto default
    const existing = await PatientDetails.findOne({
      userId,
      isDeleted: false
    });

    if (!existing) {
      req.body.isDefault = true;
    }

    // ✅ Ensure only one default
    if (req.body.isDefault) {
      await PatientDetails.updateMany(
        { userId },
        { isDefault: false }
      );
    }

    // =========================================
    // 🔥 CREATE ADDRESS (IF PROVIDED)
    // =========================================

    let addressDoc = null;

    if (fullAddress) {
      addressDoc = await Address.create({
        userId,
        fullAddress,
        city,
        state,
        pincode,
        isDefault: true
      });
    }

    // =========================================
    // 🔥 CREATE PATIENT WITH ADDRESS LINK
    // =========================================

    const patientData = {
      ...req.body,
      addressId: addressDoc ? addressDoc._id : undefined
    };

    const data = await PatientDetails.create(patientData);

    res.status(201).json({
      success: true,
      message: "Patient created successfully",
      data
    });

  } catch (err) {
    console.error("CREATE PATIENT ERROR:", err);

    res.status(500).json({
      success: false,
      message: "Failed to create patient",
      error: err.message
    });
  }
};

// ============================
// GET USER PATIENTS
// ============================
exports.getPatientDetails = async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required"
      });
    }

    const data = await PatientDetails.find({ userId, isDeleted: false })
      .sort({ isDefault: -1, createdAt: -1 });

    res.json({
      success: true,
      data
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch patients",
      error: err.message
    });
  }
};

// ============================
// GET DEFAULT PATIENT
// ============================
exports.getDefaultPatient = async (req, res) => {
  try {
    const { userId } = req.params;

    const patient = await PatientDetails.findOne({
      userId,
      isDefault: true,
      isDeleted: false
    });

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "No default patient found"
      });
    }

    res.json({
      success: true,
      data: patient
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Error fetching default patient",
      error: err.message
    });
  }
};

// ============================
// GET SINGLE PATIENT
// ============================
exports.getPatientDetailsById = async (req, res) => {
  try {
    const data = await PatientDetails.findOne({
      _id: req.params.id,
      isDeleted: false
    });

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Patient not found"
      });
    }

    res.json({
      success: true,
      data
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching patient",
      error: error.message
    });
  }
};

// ============================
// UPDATE PATIENT
// ============================
exports.updatePatientDetails = async (req, res) => {
  try {
    const patient = await PatientDetails.findById(req.params.id);

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Patient not found"
      });
    }

    // ✅ Phone validation if updating
    if (req.body.primaryPhone) {
      const phoneRegex = /^[0-9]{10}$/;
      if (!phoneRegex.test(req.body.primaryPhone)) {
        return res.status(400).json({
          success: false,
          message: "Invalid primary phone number"
        });
      }
    }

    // ✅ Handle default logic safely
    if (req.body.isDefault) {
      await PatientDetails.updateMany(
        { userId: patient.userId },
        { isDefault: false }
      );
    }

    const updated = await PatientDetails.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    res.json({
      success: true,
      message: "Patient updated successfully",
      data: updated
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Update failed",
      error: err.message
    });
  }
};

// ============================
// GET ALL (ADMIN)
// ============================
const Order = require("../models/Order");

exports.getAllPatientDetails = async (req, res) => {
  try {

const data = await PatientDetails.aggregate([
  {
    $match: {
      isDeleted: false
    }
  },
  {
    $lookup: {
      from: "orders",
      localField: "_id",
      foreignField: "patient",
      as: "orders",
    },
  },
  {
  $lookup: {
    from: "addresses",
    localField: "addressId",
    foreignField: "_id",
    as: "address"
  }
},
{
  $unwind: {
    path: "$address",
    preserveNullAndEmptyArrays: true
  }
},
  {
    $sort: { createdAt: -1 },
  },
]);

    res.json({
      success: true,
      data,
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch patients",
      error: error.message,
    });
  }
};

// ============================
// DELETE PATIENT
// ============================

exports.deletePatientDetails = async (req, res) => {
  try {
    const patientId = req.params.id;

    // ✅ 1. ADMIN CHECK FIRST (IMPORTANT)
    const userRole = req.headers.userrole;

    if (userRole !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Only admin can delete patients"
      });
    }

    // ✅ 2. FIND PATIENT
    const patient = await PatientDetails.findById(patientId);

    if (!patient || patient.isDeleted) {
      return res.status(404).json({
        success: false,
        message: "Patient not found"
      });
    }

    // ✅ 3. CHECK IF ANY ORDERS EXIST
    const orderExists = await Order.exists({ patient: patient._id });

    if (orderExists) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete patient with orders"
      });
    }

    // ✅ 4. HANDLE DEFAULT PATIENT SWITCH
    if (patient.isDefault) {
      const next = await PatientDetails.findOne({
        userId: patient.userId,
        _id: { $ne: patient._id },
        isDeleted: false
      }).sort({ createdAt: -1 });

      if (next) {
        next.isDefault = true;
        await next.save();
      }
    }

    // ✅ 5. SOFT DELETE
    patient.isDeleted = true;
    await patient.save();

    return res.status(200).json({
      success: true,
      message: "Patient deleted successfully"
    });

  } catch (err) {
    console.error("DELETE PATIENT ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Delete failed",
      error: err.message
    });
  }
};