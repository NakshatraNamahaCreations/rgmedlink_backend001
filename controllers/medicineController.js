const Medicine = require("../models/Medicine");

/* ── pagination helper ───────────────────────────────────────── */
function paginate(query) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const raw = parseInt(query.limit);
  const all = raw === 0;
  const limit = all ? 0 : Math.min(Math.max(raw || 10, 1), 100);
  const skip = all ? 0 : (page - 1) * limit;
  return { page, limit, skip, all };
}


/* ===============================
   CREATE MEDICINE
================================ */
exports.createMedicine = async (req, res) => {
  try {
    const data = req.body;
    if (!req.body.sellingPrice && req.body.price) {
  req.body.sellingPrice = req.body.price;
}

    if (data.status === "Inactive" && !data.inactiveReason) {
      return res.status(400).json({ message: "Reason required for inactive medicine" });
    }

    const medicine = await Medicine.create(data);
    res.status(201).json(medicine);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


/* ===============================
   GET ALL MEDICINES (paginated when params present)
================================ */
exports.getMedicines = async (req, res) => {
  try {
    const hasPageParams = req.query.page || req.query.limit;

    if (!hasPageParams) {
      // Legacy: return raw array for backward compat (mobile app, dashboard)
      const medicines = await Medicine.find().sort({ createdAt: -1 });
      return res.json(medicines);
    }

    // Paginated response
    const { page, limit, skip, all } = paginate(req.query);
    const { search, status, category } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (category) filter.category = { $regex: category, $options: "i" };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { category: { $regex: search, $options: "i" } },
      ];
    }

    let q = Medicine.find(filter).sort({ createdAt: -1 });
    if (!all) q = q.skip(skip).limit(limit);

    const [medicines, total] = await Promise.all([q, Medicine.countDocuments(filter)]);

    res.json({
      success: true,
      data: medicines,
      pagination: {
        page: all ? 1 : page,
        limit: all ? total : limit,
        total,
        totalPages: all ? 1 : Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


/* ===============================
   GET SINGLE MEDICINE
================================ */
exports.getMedicineById = async (req, res) => {
  try {
    const medicine = await Medicine.findById(req.params.id);

    if (!medicine) {
      return res.status(404).json({ message: "Medicine not found" });
    }

    res.json(medicine);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ===============================
   UPDATE MEDICINE
================================ */
exports.updateMedicine = async (req, res) => {
  try {
    // Ensure sellingPrice always exists
if (!req.body.sellingPrice && req.body.price) {
  req.body.sellingPrice = req.body.price;
}
    const medicine = await Medicine.findByIdAndUpdate(req.params.id, req.body, { new: true,  runValidators: true });
    res.json(medicine);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


/* ===============================
   DELETE MEDICINE
================================ */
exports.deleteMedicine = async (req, res) => {
  try {
    const medicine = await Medicine.findByIdAndDelete(req.params.id);

    if (!medicine) {
      return res.status(404).json({ message: "Medicine not found" });
    }

    res.json({ message: "Medicine deleted successfully" });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


/* ===============================
   ADJUST STOCK
================================ */
exports.adjustStock = async (req, res) => {
  try {
    const { type, quantity } = req.body;

    // 🔍 Validate medicine
    const medicine = await Medicine.findById(req.params.id);
    if (!medicine) {
      return res.status(404).json({ message: "Medicine not found" });
    }

    // 🔍 Validate type
    if (!["add", "reduce"].includes(type)) {
      return res.status(400).json({ message: "Invalid type. Use 'add' or 'reduce'" });
    }

    // 🔍 Validate quantity
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      return res.status(400).json({ message: "Invalid quantity" });
    }

    // ➕ Add stock
    if (type === "add") {
      medicine.stock += qty;
    }

    // ➖ Reduce stock
    if (type === "reduce") {
      if (medicine.stock < qty) {
        return res.status(400).json({ message: "Insufficient stock" });
      }

      medicine.stock -= qty;

      // 📊 Update demand tracking
      medicine.demand30 = (medicine.demand30 || 0) + qty;
      medicine.demand90 = (medicine.demand90 || 0) + qty;
    }

    // 💾 Save changes
    await medicine.save();

    return res.json({
      success: true,
      message: "Stock updated successfully",
      medicine,
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Stock update failed",
      error: error.message,
    });
  }
};
