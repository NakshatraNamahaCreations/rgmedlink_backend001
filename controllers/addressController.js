const Address = require("../models/Address");

// ============================
// CREATE ADDRESS
// ============================
exports.saveAddress = async (req, res) => {
  try {
    const { userId, fullAddress } = req.body;

    if (!userId || !fullAddress) {
      return res.status(400).json({
        success: false,
        message: "userId and fullAddress are required"
      });
    }

    // ✅ First address auto default
    const existing = await Address.findOne({ userId });
    if (!existing) {
      req.body.isDefault = true;
    }

    // ✅ Only one default
    if (req.body.isDefault) {
      await Address.updateMany(
        { userId },
        { isDefault: false }
      );
    }

    const address = await Address.create(req.body);

    res.status(201).json({
      success: true,
      message: "Address saved successfully",
      data: address
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to save address",
      error: err.message
    });
  }
};



// ============================
// GET USER ADDRESSES
// ============================
exports.getUserAddresses = async (req, res) => {
  try {
    const data = await Address.find({
      userId: req.params.userId
    }).sort({ isDefault: -1, createdAt: -1 });

    res.json({
      success: true,
      data
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};



// ============================
// GET DEFAULT ADDRESS
// ============================
exports.getDefaultAddress = async (req, res) => {
  try {
    const address = await Address.findOne({
      userId: req.params.userId,
      isDefault: true
    });

    if (!address) {
      return res.status(404).json({
        success: false,
        message: "No default address found"
      });
    }

    res.json({
      success: true,
      data: address
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};



// ============================
// UPDATE ADDRESS
// ============================
exports.updateAddress = async (req, res) => {
  try {
    const address = await Address.findById(req.params.id);

    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found"
      });
    }

    // ✅ Handle default switch
    if (req.body.isDefault) {
      await Address.updateMany(
        { userId: address.userId },
        { isDefault: false }
      );
    }

    const updated = await Address.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    res.json({
      success: true,
      message: "Address updated",
      data: updated
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};



// ============================
// DELETE ADDRESS
// ============================
exports.deleteAddress = async (req, res) => {
  try {
    const address = await Address.findById(req.params.id);

    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found"
      });
    }

    // ❌ Prevent deleting default
    if (address.isDefault) {
      return res.status(400).json({
        success: false,
        message: "Default address cannot be deleted"
      });
    }

    // ✅ Ensure at least one remains
    const count = await Address.countDocuments({
      userId: address.userId
    });

    if (count <= 1) {
      return res.status(400).json({
        success: false,
        message: "At least one address is required"
      });
    }

    await Address.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Address deleted successfully"
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};