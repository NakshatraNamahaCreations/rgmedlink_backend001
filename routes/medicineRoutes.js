const router = require("express").Router();

const controller = require("../controllers/medicineController");
const upload = require("../middleware/upload"); // ✅ ADD THIS

// ===============================
// BASIC CRUD
// ===============================
router.post("/", controller.createMedicine);

router.get("/", controller.getMedicines);

router.get("/:id", controller.getMedicineById);

router.put("/:id", controller.updateMedicine);

router.delete("/:id", controller.deleteMedicine);

router.patch("/:id/adjust-stock", controller.adjustStock);

router.post("/bulk-save", controller.bulkSaveMedicines);
// ===============================
// ✅ EXCEL UPLOAD (ADD THIS)
// ===============================
router.post(
  "/upload-excel",
  upload.single("file"),
  controller.uploadMedicinesExcel
);

module.exports = router;