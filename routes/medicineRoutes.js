const router = require("express").Router();

const controller = require("../controllers/medicineController");


router.post("/", controller.createMedicine);

router.get("/", controller.getMedicines);

router.get("/:id", controller.getMedicineById);

router.put("/:id", controller.updateMedicine);

router.delete("/:id", controller.deleteMedicine);

router.patch("/:id/adjust-stock", controller.adjustStock);


module.exports = router;