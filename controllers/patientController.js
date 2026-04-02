const Patient      = require("../models/Patient");
const Prescription = require("../models/Prescription");
const Order        = require("../models/Order");

/* ── pagination helper ───────────────────────────────────────── */
function paginate(query) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const raw = parseInt(query.limit);
  const all = raw === 0;
  const limit = all ? 0 : Math.min(Math.max(raw || 10, 1), 100);
  const skip = all ? 0 : (page - 1) * limit;
  return { page, limit, skip, all };
}

/* ============================================================
   GET /api/patients/stats
   Single aggregation instead of 6 separate countDocuments
============================================================ */
exports.getPatientStats = async (req, res) => {
  try {
    const today          = new Date();
    const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd   = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);

    const [total, newThisMonth, newLastMonth, genderAgg, withPrescriptions] = await Promise.all([
      Patient.countDocuments(),
      Patient.countDocuments({ createdAt: { $gte: thisMonthStart } }),
      Patient.countDocuments({ createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd } }),
      Patient.aggregate([
        { $group: { _id: "$gender", count: { $sum: 1 } } },
      ]),
      Prescription.distinct("patient"),
    ]);

    const genderMap = {};
    genderAgg.forEach((g) => { genderMap[g._id] = g.count; });

    const growthPct = newLastMonth === 0
      ? (newThisMonth > 0 ? 100 : 0)
      : Math.round(((newThisMonth - newLastMonth) / newLastMonth) * 100);

    res.json({
      success: true,
      data: {
        total,
        newThisMonth,
        newLastMonth,
        growthPct,
        withPrescriptions: withPrescriptions.length,
        gender: {
          male: genderMap["Male"] || 0,
          female: genderMap["Female"] || 0,
          other: genderMap["Other"] || 0,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};


/* ============================================================
   GET /api/patients/:id/profile
============================================================ */
exports.getPatientProfile = async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id).lean();
    if (!patient)
      return res.status(404).json({ success: false, message: "Patient not found" });

    const [prescriptions, orders] = await Promise.all([
      Prescription.find({ patient: patient._id })
        .populate("meds.medicine", "name unit price")
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),

      Order.find({ userId: patient._id.toString() })
        .sort({ createdAt: -1 })
        .limit(10)
        .select("orderId orderStatus paymentStatus totalAmount createdAt addressDetails")
        .lean(),
    ]);

    const totalSpent = prescriptions
      .filter((rx) => rx.payStatus === "Paid")
      .reduce((sum, rx) => sum + (rx.total || 0), 0);

    res.json({
      success: true,
      data: {
        patient,
        stats: {
          totalPrescriptions: prescriptions.length,
          paidPrescriptions:  prescriptions.filter((rx) => rx.payStatus === "Paid").length,
          totalOrders:        orders.length,
          totalSpent:         Math.round(totalSpent * 100) / 100,
        },
        prescriptions,
        orders,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};


/* ============================================================
   POST /api/patients
============================================================ */
exports.createPatient = async (req, res) => {
  try {
    const { name, phone, age, gender, email, address, city, state, pincode, condition, emergencyContact, since, adherence } = req.body;

    if (!name || !name.trim())
      return res.status(400).json({ success: false, message: "Patient name is required" });
    if (!phone || !/^[0-9]{10}$/.test(phone))
      return res.status(400).json({ success: false, message: "Valid 10-digit phone number is required" });

    const last = await Patient.findOne().sort({ patientId: -1 }).select("patientId").lean();
    let nextNum = 1;
    if (last?.patientId) {
      const num = parseInt(last.patientId.replace(/\D/g, ""), 10);
      if (!isNaN(num)) nextNum = num + 1;
    }
    const patientId = "P" + String(nextNum).padStart(3, "0");

    const patient = await Patient.create({
      patientId, name: name.trim(), phone, age, gender, email,
      address, city, state, pincode, condition, emergencyContact, since, adherence,
    });

    res.status(201).json({ success: true, data: patient });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to create patient", error: err.message });
  }
};


/* ============================================================
   GET /api/patients  (server-side paginated)
============================================================ */
exports.getPatients = async (req, res) => {
  try {
    const { page, limit, skip, all } = paginate(req.query);
    const { search, gender, city, condition, from, to } = req.query;
    const filter = {};

    if (gender) filter.gender = gender;
    if (city) filter.city = { $regex: city, $options: "i" };
    if (condition) filter.condition = { $regex: condition, $options: "i" };

    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }

    if (search) {
      const term = search.trim();
      filter.$or = [
        { name: { $regex: term, $options: "i" } },
        { phone: { $regex: term, $options: "i" } },
        { patientId: { $regex: term, $options: "i" } },
        { email: { $regex: term, $options: "i" } },
      ];
    }

    let q = Patient.find(filter).sort({ createdAt: -1 }).lean();
    if (!all) q = q.skip(skip).limit(limit);

    const [patients, total] = await Promise.all([q, Patient.countDocuments(filter)]);

    res.json({
      success: true,
      total,
      data: patients,
      pagination: {
        page: all ? 1 : page,
        limit: all ? total : limit,
        total,
        totalPages: all ? 1 : Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch patients", error: err.message });
  }
};


/* ============================================================
   GET /api/patients/:id
============================================================ */
exports.getPatientById = async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id).lean();
    if (!patient)
      return res.status(404).json({ success: false, message: "Patient not found" });

    res.json({ success: true, data: patient });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching patient", error: err.message });
  }
};


/* ============================================================
   PUT /api/patients/:id
============================================================ */
exports.updatePatient = async (req, res) => {
  try {
    const { name, age, gender, phone, email, address, city, state, pincode, condition, emergencyContact, since, adherence } = req.body;

    if (phone && !/^[0-9]{10}$/.test(phone))
      return res.status(400).json({ success: false, message: "Valid 10-digit phone number is required" });

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (age !== undefined) updates.age = age;
    if (gender !== undefined) updates.gender = gender;
    if (phone !== undefined) updates.phone = phone;
    if (email !== undefined) updates.email = email;
    if (address !== undefined) updates.address = address;
    if (city !== undefined) updates.city = city;
    if (state !== undefined) updates.state = state;
    if (pincode !== undefined) updates.pincode = pincode;
    if (condition !== undefined) updates.condition = condition;
    if (emergencyContact !== undefined) updates.emergencyContact = emergencyContact;
    if (since !== undefined) updates.since = since;
    if (adherence !== undefined) updates.adherence = adherence;

    if (Object.keys(updates).length === 0)
      return res.status(400).json({ success: false, message: "No valid fields to update" });

    const patient = await Patient.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!patient)
      return res.status(404).json({ success: false, message: "Patient not found" });

    res.json({ success: true, message: "Patient updated successfully", data: patient });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update patient", error: err.message });
  }
};


/* ============================================================
   DELETE /api/patients/:id
============================================================ */
exports.deletePatient = async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.id).select("_id").lean();
    if (!patient)
      return res.status(404).json({ success: false, message: "Patient not found" });

    const paidCount = await Prescription.countDocuments({ patient: patient._id, payStatus: "Paid" });
    if (paidCount > 0)
      return res.status(400).json({
        success: false,
        message: `Cannot delete patient with ${paidCount} paid prescription(s). Archive instead.`,
      });

    await Patient.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Patient deleted successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to delete patient", error: err.message });
  }
};
