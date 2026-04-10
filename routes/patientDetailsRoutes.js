const express = require("express");
const router = express.Router();

const {
  createPatientDetails,
  getPatientDetails,
  getPatientDetailsById,
  updatePatientDetails,
  getAllPatientDetails,
  deletePatientDetails,
  getPatientStats
} = require("../controllers/patientDetailsController");

router.post("/create", createPatientDetails);

// ✅ Correct order
router.get("/all", getAllPatientDetails);

// ✅ FIX HERE
router.get("/stats", getPatientStats);

// Existing routes
router.get("/", getPatientDetails);
router.get("/:id", getPatientDetailsById);
router.put("/:id", updatePatientDetails);
router.delete("/:id", deletePatientDetails);

module.exports = router;