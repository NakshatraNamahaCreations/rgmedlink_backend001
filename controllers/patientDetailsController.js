const PatientDetails = require("../models/PatientDetails");

// ============================
// CREATE PATIENT
// ============================
exports.createPatientDetails = async (req, res) => {
  try {
    const { userId, name, primaryPhone } = req.body;

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

    // ✅ First patient auto-default
    const existing = await PatientDetails.findOne({ userId });
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

    const data = await PatientDetails.create(req.body);

    res.status(201).json({
      success: true,
      message: "Patient created successfully",
      data
    });

  } catch (err) {
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

    const data = await PatientDetails.find({ userId })
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
      isDefault: true
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
    const data = await PatientDetails.findById(req.params.id);

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
exports.getAllPatientDetails = async (req, res) => {
  try {
    const data = await PatientDetails.find()
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch all patients",
      error: error.message
    });
  }
};

// ============================
// DELETE PATIENT
// ============================
exports.deletePatientDetails = async (req, res) => {
  try {
    const patient = await PatientDetails.findById(req.params.id);

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Patient not found"
      });
    }

    // ❌ Prevent deleting default
    if (patient.isDefault) {
      return res.status(400).json({
        success: false,
        message: "Default patient cannot be deleted"
      });
    }

    await PatientDetails.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Patient deleted successfully"
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Delete failed",
      error: err.message
    });
  }
};