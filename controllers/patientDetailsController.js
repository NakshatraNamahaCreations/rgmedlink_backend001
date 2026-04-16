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
//     const existingPatient = await PatientDetails.findOne({
//       primaryPhone,
//       userId,
//       isDeleted: false
//     });

// if (existingPatient) {
//   return res.status(400).json({
//     success: false,
//     message: "Patient already exists with this phone"
//   });
// }

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

// ✅ CREATE ADDRESS IF ADMIN SENDS IT
if (!req.body.addressId && fullAddress) {
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
  addressId: req.body.addressId || (addressDoc ? addressDoc._id : undefined)
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
  { $match: { isDeleted: false } },

  // =========================
  // ✅ GET ORDERS
  // =========================
  {
    $lookup: {
      from: "orders",
      localField: "_id",
      foreignField: "patient",
      as: "orders"
    }
  },

  // =========================
  // ✅ UNWIND ORDERS
  // =========================
  {
    $unwind: {
      path: "$orders",
      preserveNullAndEmptyArrays: true
    }
  },

  // =========================
  // ✅ POPULATE PRESCRIPTION
  // =========================
  {
    $lookup: {
      from: "prescriptions",
      localField: "orders.prescription",
      foreignField: "_id",
      as: "prescriptionData"
    }
  },
  {
    $unwind: {
      path: "$prescriptionData",
      preserveNullAndEmptyArrays: true
    }
  },

  // =========================
  // ✅ MERGE PRESCRIPTION INTO ORDER
  // =========================
  {
    $addFields: {
      "orders.prescription": "$prescriptionData"
    }
  },
  {
    $project: {
      prescriptionData: 0
    }
  },

  // =========================
  // ✅ GROUP BACK ORDERS
  // =========================
  {
    $group: {
      _id: "$_id",
      doc: { $first: "$$ROOT" },
      orders: { $push: "$orders" }
    }
  },

  // =========================
  // ✅ RESTORE ROOT STRUCTURE
  // =========================
  {
    $replaceRoot: {
      newRoot: {
        $mergeObjects: ["$doc", { orders: "$orders" }]
      }
    }
  },

  // =========================
  // ✅ REMOVE NULL ORDERS (IMPORTANT)
  // =========================
  {
    $addFields: {
      orders: {
        $filter: {
          input: "$orders",
          as: "o",
          cond: { $ne: ["$$o", null] }
        }
      }
    }
  },

  // =========================
  // ✅ POPULATE ADDRESS
  // =========================
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

  // =========================
  // ✅ SORT
  // =========================
  {
    $sort: { createdAt: -1 }
  }
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
// GET PATIENT STATS (ADD THIS)
// ============================
exports.getPatientStats = async (req, res) => {
  try {

    const patients = await PatientDetails.aggregate([
      { $match: { isDeleted: false } },

      {
        $lookup: {
          from: "orders",
          localField: "_id",
          foreignField: "patient",
          as: "orders"
        }
      }
    ]);

    let total = patients.length;
    let male = 0;
    let female = 0;
    let withPrescriptions = 0;
    let newThisMonth = 0;

    const startOfMonth = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1
    );

    patients.forEach(p => {
      // ✅ Gender count
      if (p.gender === "Male") male++;
      else if (p.gender === "Female") female++;

      // ✅ New this month
      if (new Date(p.createdAt) >= startOfMonth) {
        newThisMonth++;
      }

      // ✅ With prescription (CORRECT FIX)
      const hasOrder = p.orders && p.orders.length > 0;

if (hasOrder) withPrescriptions++;

    });

    res.json({
      success: true,
      data: {
        total,
        newThisMonth,
        growthPct: 0,
        withPrescriptions,
        gender: {
          male,
          female,
          other: total - (male + female)
        }
      }
    });

  } catch (err) {
    console.error("STATS ERROR:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};


// ============================
// DELETE PATIENT
// ============================
exports.deletePatientDetails = async (req, res) => {
  try {
    const patientId = req.params.id;

    // ✅ 1. FIND PATIENT FIRST
    const patient = await PatientDetails.findById(patientId);

    if (!patient || patient.isDeleted) {
      return res.status(404).json({
        success: false,
        message: "Patient not found"
      });
    }

    // ✅ 2. CHECK USER OWNERSHIP
    // if (patient.userId !== req.user?.phone) {
    //   return res.status(403).json({
    //     success: false,
    //     message: "Not authorized"
    //   });
    // }
// ✅ Allow Postman bypass ONLY in development
const isPostman =
  req.headers["x-debug-mode"] === "true" &&
  process.env.NODE_ENV !== "production";

if (!isPostman) {
  if (patient.userId !== req.user?.phone) {
    return res.status(403).json({
      success: false,
      message: "Not authorized"
    });
  }
}

    // ✅ 3. CHECK ORDERS
   const orderExists = await Order.exists({
  patient: patient._id,
  isDeleted: false   // ✅ add this line
});

    if (orderExists) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete patient with orders"
      });
    }

    // ✅ 4. HANDLE DEFAULT SWITCH
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

    // ✅ 5. USER DELETE (SOFT DELETE)
    patient.isDeleted = true;
    await patient.save();

    res.status(200).json({
      success: true,
      message: "Patient deleted successfully"
    });

  } catch (err) {
    console.error("DELETE ERROR:", err);

    res.status(500).json({
      success: false,
      message: "Delete failed",
      error: err.message
    });
  }
};