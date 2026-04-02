const router = require("express").Router();
const ctrl   = require("../controllers/prescriptionController");

// Stats for tab header cards
router.get("/stats", ctrl.getPrescriptionStats);

// Cleanup unpaid orphaned prescriptions
router.delete("/cleanup", ctrl.cleanUnusedPrescriptions);

// CRUD
router.post("/",    ctrl.createPrescription);
router.get("/",     ctrl.getPrescriptions);
router.get("/:id",  ctrl.getPrescriptionById);
router.put("/:id",  ctrl.updatePrescription);
router.delete("/:id", ctrl.deletePrescription);

// Actions
router.patch("/:id/status",          ctrl.updatePrescriptionStatus);
router.post("/:id/renew",            ctrl.renewPrescription);
router.post("/:id/process-payment",  ctrl.processPayment);

module.exports = router;
