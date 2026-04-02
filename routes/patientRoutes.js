const express    = require("express");
const router     = express.Router();
const controller = require("../controllers/patientController");

/* Stats for tab header cards */
router.get("/stats", controller.getPatientStats);

/* CRUD */
router.post("/",    controller.createPatient);
router.get("/",     controller.getPatients);
router.get("/:id",  controller.getPatientById);
router.put("/:id",  controller.updatePatient);
router.delete("/:id", controller.deletePatient);

/* Full profile — patient + prescriptions + orders */
router.get("/:id/profile", controller.getPatientProfile);

module.exports = router;
