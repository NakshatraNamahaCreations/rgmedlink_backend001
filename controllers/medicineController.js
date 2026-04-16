const Medicine = require("../models/Medicine");
const XLSX = require("xlsx");


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
   BULK UPLOAD MEDICINES (EXCEL)
================================ */
exports.uploadMedicinesExcel = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Excel file required" });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);

    // ✅ CLEAN FUNCTION (remove spaces, tabs, multiple spaces)
    const clean = (val) =>
      typeof val === "string"
        ? val.replace(/\s+/g, " ").trim()
        : val;

    // ✅ CLEAN WHOLE ROW (VERY IMPORTANT)
    const cleanRow = (row) => {
      const cleaned = {};
      for (let key in row) {
        cleaned[key] = clean(row[key]);
      }
      return cleaned;
    };

    let parsedData = [];

    for (let row of data) {
      // ✅ CLEAN ENTIRE ROW
      const r = cleanRow(row);

      const name = r.name || r.MedicineName;
      if (!name) continue;

      const normalize = (str) =>
        str.toLowerCase().replace(/\s+/g, " ").trim();

      const normalizedName = normalize(name);

const existing = await Medicine.findOne({
  normalizedName
});

      
    // ✅ CATEGORY-BASED UNIT VALIDATION
      const categoryUnitMap = {
        Liquid: ["ML"],
        Powder: ["Grams"],
        Tablet: ["Tablet", "Strip"],
        Capsule: ["Capsule"],
        Syrup: ["ML"],
        Injection: ["ML"],
        Ointment: ["Grams"],
        Device: ["Unit"]
      };

      const category = r.category || "Tablet";
      const allowedUnits = categoryUnitMap[category] || ["Tablet"];

      const unit = allowedUnits.includes(r.unit)
        ? r.unit
        : allowedUnits[0];

      const payload = {
        name,
        category: r.category || "Tablet",
        unit,
        costPrice: Number(r.costPrice) || 0,
        sellingPrice: Number(r.sellingPrice) || 0,
        stock: Number(r.stock) || 0,
        minStock: Number(r.minStock) || 10,
        status: r.status || "Active",
      };

      parsedData.push({
        ...payload,
        exists: !!existing,
        id: existing?._id || null
      });
    }

    return res.json({
      success: true,
      data: parsedData
    });

  } catch (error) {
    res.status(500).json({
      message: "Excel parsing failed",
      error: error.message,
    });
  }
};


exports.bulkSaveMedicines = async (req, res) => {
  try {
    const medicines = req.body.medicines;

    let created = 0;
    let updated = 0;

for (let item of medicines) {
  const { id, exists, ...cleanData } = item;

  if (id) {
   const updatedData = {
  ...cleanData,
  normalizedName: cleanData.name
    ?.toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
};

await Medicine.findByIdAndUpdate(id, updatedData);
    updated++;
  } else {
   const normalizedName = cleanData.name
  ?.toLowerCase()
  .replace(/\s+/g, " ")
  .trim();

await Medicine.findOneAndUpdate(
  { normalizedName },
  {
    ...cleanData,
    normalizedName
  },
  { upsert: true, new: true }
);
    created++;
  }
}

    res.json({
      success: true,
      created,
      updated
    });

  } catch (error) {
    res.status(500).json({
      message: "Bulk save failed",
      error: error.message
    });
  }
};

/* ===============================
   CREATE MEDICINE
================================ */

exports.createMedicine = async (req, res) => {
  try {
    const data = req.body;

    // Fix sellingPrice fallback
    if (!data.sellingPrice && data.price) {
      data.sellingPrice = data.price;
    }

    // Inactive validation
    if (data.status === "Inactive" && !data.inactiveReason) {
      return res.status(400).json({
        message: "Reason required for inactive medicine"
      });
    }

    // ✅ CATEGORY-UNIT VALIDATION
    const categoryUnitMap = {
      Liquid: ["ML"],
      Powder: ["Grams"],
      Tablet: ["Tablet", "Strip"],
      Capsule: ["Capsule"],
      Syrup: ["ML"],
      Injection: ["ML"],
      Ointment: ["Grams"],
      Device: ["Unit"]
    };

    const { category, unit } = data;

    if (categoryUnitMap[category]) {
      if (!categoryUnitMap[category].includes(unit)) {
        return res.status(400).json({
          message: `Invalid unit '${unit}' for category '${category}'`
        });
      }
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

    if (!req.body.sellingPrice && req.body.price) {
      req.body.sellingPrice = req.body.price;
    }

    // ✅ ADD SAME VALIDATION
    const categoryUnitMap = {
      Liquid: ["ML"],
      Powder: ["Grams"],
      Tablet: ["Tablet", "Strip"],
      Capsule: ["Capsule"],
      Syrup: ["ML"],
      Injection: ["ML"],
      Ointment: ["Grams"],
      Device: ["Unit"]
    };

    const { category, unit } = req.body;

    if (categoryUnitMap[category]) {
      if (!categoryUnitMap[category].includes(unit)) {
        return res.status(400).json({
          message: `Invalid unit '${unit}' for category '${category}'`
        });
      }
    }

const updatedData = {
  ...req.body,
  normalizedName: req.body.name
    ?.toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
};

const medicine = await Medicine.findByIdAndUpdate(
  req.params.id,
  updatedData,
  { new: true, runValidators: true }
);

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
