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
    const medicine = await Medicine.findByIdAndUpdate(req.params.id, req.body, { new: true });
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
    await Medicine.findByIdAndDelete(req.params.id);
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
    const medicine = await Medicine.findById(req.params.id);

    if (!medicine)
      return res.status(404).json({ message: "Medicine not found" });

    const qty = Number(quantity);

    if (type === "add") {
      medicine.stock += qty;
    }

    if (type === "reduce") {
      if (medicine.stock < qty)
        return res.status(400).json({ message: "Insufficient stock" });

      medicine.stock -= qty;
      medicine.demand30 += qty;
      medicine.demand90 += qty;
    }

    await medicine.save();
    res.json({ message: "Stock updated successfully", medicine });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
