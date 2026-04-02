const express = require("express");
const router = express.Router();

const {
  createPatientDetails,
  getPatientDetails,
  getPatientDetailsById,
  updatePatientDetails,
  getAllPatientDetails,
  deletePatientDetails
} = require("../controllers/patientDetailsController");

router.post("/create", createPatientDetails);

// ✅ MOVE THIS UP
router.get("/all", getAllPatientDetails);

// Existing routes
router.get("/", getPatientDetails);
router.get("/:id", getPatientDetailsById);
router.put("/:id", updatePatientDetails);
router.delete("/:id", deletePatientDetails);

module.exports = router;