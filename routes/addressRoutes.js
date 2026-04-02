const express = require("express");
const router = express.Router();

const Address = require("../models/Address");

const {
  saveAddress,
  getUserAddresses,
  updateAddress,
  deleteAddress,
  getDefaultAddress
} = require("../controllers/addressController");

/* DELETE SINGLE */
router.delete("/delete/:id", deleteAddress);

/* CREATE */
router.post("/save", saveAddress);

/* GET USER ADDRESSES */
router.get("/:userId", getUserAddresses);


router.get("/default/:userId", getDefaultAddress);
/* UPDATE */
router.put("/update/:id", updateAddress);

/* DELETE ALL */
router.delete("/delete-all/:userId", async (req, res) => {
  try {
    await Address.deleteMany({ userId: req.params.userId });

    res.json({ message: "All addresses deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;