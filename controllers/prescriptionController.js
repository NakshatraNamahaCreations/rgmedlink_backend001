const Prescription = require("../models/Prescription");
const Medicine     = require("../models/Medicine");
const Order        = require("../models/Order");
const Patient      = require("../models/Patient");

/* ── pagination helper ───────────────────────────────────────── */
function paginate(query) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const raw = parseInt(query.limit);
  const all = raw === 0;
  const limit = all ? 0 : Math.min(Math.max(raw || 10, 1), 100);
  const skip = all ? 0 : (page - 1) * limit;
  return { page, limit, skip, all };
}

/* ─────────────────────────────────────────────
   HELPER: build processed meds + totals
   Single batch query instead of N+1 findById loops
───────────────────────────────────────────── */
async function buildMeds(meds, discount = 0, checkStock = true) {
  // ── Fetch ALL medicines in one query ──
  const medicineIds = meds.map((m) => m.medicine);
  const medicineDocs = await Medicine.find({ _id: { $in: medicineIds } }).lean();
  const medMap = {};
  medicineDocs.forEach((m) => { medMap[m._id.toString()] = m; });

  let subtotal = 0;
  let maxDuration = 0;
  const processedMeds = [];

  for (const m of meds) {
    const medDoc = medMap[m.medicine.toString ? m.medicine.toString() : m.medicine];
    if (!medDoc) throw `Medicine ${m.medicine} not found`;

    const freq = m.freq || { m: 0, a: 0, n: 0 };
    const daily = (freq.m || 0) + (freq.a || 0) + (freq.n || 0);
    const qty = m.qty ?? daily * (m.duration || 1);

    if (checkStock && medDoc.stock < qty)
      throw `Insufficient stock for ${medDoc.name}. Available: ${medDoc.stock}, Required: ${qty}`;

    const price = medDoc.price || 0;
    const sub = qty * price;
    subtotal += sub;
    maxDuration = Math.max(maxDuration, m.duration || 1);

    processedMeds.push({
      medicine: medDoc._id,
      duration: m.duration || 1,
      freq,
      qty,
      price,
      subtotal: sub,
    });
  }

  // GST calc using already-fetched docs (no second query)
  let gstAmount = 0;
  processedMeds.forEach((m) => {
    const gstPct = medMap[m.medicine.toString()]?.gstPct ?? 12;
    gstAmount += m.subtotal * (gstPct / 100);
  });
  gstAmount = Math.round(gstAmount * 100) / 100;

  const total = Math.round((subtotal + gstAmount - discount) * 100) / 100;

  return { processedMeds, subtotal, gst: gstAmount, total, maxDuration };
}


/* ============================================================
   GET /api/prescriptions/stats
============================================================ */
exports.getPrescriptionStats = async (req, res) => {
  try {
    // Single aggregation instead of 6 separate countDocuments
    const [statusAgg, payAgg, revenueAgg] = await Promise.all([
      Prescription.aggregate([
        { $group: { _id: "$orderStatus", count: { $sum: 1 } } },
      ]),
      Prescription.aggregate([
        { $group: { _id: "$payStatus", count: { $sum: 1 } } },
      ]),
      Prescription.aggregate([
        { $match: { payStatus: "Paid" } },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]),
    ]);

    const byStatus = {};
    statusAgg.forEach((s) => { byStatus[s._id] = s.count; });
    const byPay = {};
    payAgg.forEach((p) => { byPay[p._id] = p.count; });

    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

    res.json({
      success: true,
      data: {
        total,
        pending: byStatus["Pending"] || 0,
        processing: byStatus["Processing"] || 0,
        delivered: byStatus["Delivered"] || 0,
        paid: byPay["Paid"] || 0,
        unpaid: byPay["Unpaid"] || 0,
        totalRevenue: revenueAgg[0]?.total || 0,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};


/* ============================================================
   POST /api/prescriptions
   Create prescription — bulk stock deduction
============================================================ */
exports.createPrescription = async (req, res) => {
  try {
    const { patient, doctor, start, discount = 0, meds } = req.body;

    if (!patient || !doctor || !start)
      return res.status(400).json({ success: false, message: "patient, doctor and start date are required" });
    if (!meds || meds.length === 0)
      return res.status(400).json({ success: false, message: "No medicines provided" });

    const patientDoc = await Patient.findById(patient).lean();
    if (!patientDoc)
      return res.status(404).json({ success: false, message: "Patient not found" });

    let built;
    try {
      built = await buildMeds(meds, discount, true);
    } catch (msg) {
      return res.status(400).json({ success: false, message: msg });
    }

    const { processedMeds, subtotal, gst, total, maxDuration } = built;

    // ── Bulk stock deduction ──
    await Medicine.bulkWrite(
      processedMeds.map((m) => ({
        updateOne: {
          filter: { _id: m.medicine },
          update: { $inc: { stock: -m.qty, demand30: m.qty, demand90: m.qty } },
        },
      }))
    );

    const start_d = new Date(start);
    const expiryDate = new Date(start_d);
    expiryDate.setDate(expiryDate.getDate() + maxDuration);

    const rx = await Prescription.create({
      rxId: `RX-${Date.now()}`,
      patient,
      doctor,
      start: start_d,
      expiry: expiryDate,
      subtotal,
      gst,
      discount,
      total,
      payStatus: "Unpaid",
      orderStatus: "Pending",
      meds: processedMeds,
    });

    const populated = await Prescription.findById(rx._id)
      .populate("patient", "name patientId phone gender")
      .populate("meds.medicine", "name unit price");

    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    console.error("Create Prescription Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};


/* ============================================================
   GET /api/prescriptions  (server-side paginated)
============================================================ */
exports.getPrescriptions = async (req, res) => {
  try {
    const { page, limit, skip, all } = paginate(req.query);
    const { payStatus, orderStatus, patientId, search, from, to } = req.query;
    const filter = {};

    if (payStatus) filter.payStatus = payStatus;
    if (orderStatus) filter.orderStatus = orderStatus;
    if (patientId) filter.patient = patientId;

    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }

    // Server-side search across patient name, rxId, doctor
    if (search) {
      const matchingPatients = await Patient.find({
        $or: [
          { name: { $regex: search, $options: "i" } },
          { patientId: { $regex: search, $options: "i" } },
        ],
      }).select("_id").lean();

      const patientIds = matchingPatients.map((p) => p._id);

      filter.$or = [
        { rxId: { $regex: search, $options: "i" } },
        { doctor: { $regex: search, $options: "i" } },
        ...(patientIds.length ? [{ patient: { $in: patientIds } }] : []),
      ];
    }

    let q = Prescription.find(filter)
      .populate("patient", "name patientId phone gender city")
      .populate("meds.medicine", "name unit price category")
      .sort({ createdAt: -1 });

    if (!all) q = q.skip(skip).limit(limit);

    const [results, total] = await Promise.all([q, Prescription.countDocuments(filter)]);

    res.json({
      success: true,
      total,
      data: results,
      pagination: {
        page: all ? 1 : page,
        limit: all ? total : limit,
        total,
        totalPages: all ? 1 : Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};


/* ============================================================
   GET /api/prescriptions/:id
============================================================ */
exports.getPrescriptionById = async (req, res) => {
  try {
    const rx = await Prescription.findById(req.params.id)
      .populate("patient", "name patientId phone gender age city state")
      .populate("meds.medicine", "name unit price category gstPct stock");

    if (!rx) return res.status(404).json({ success: false, message: "Prescription not found" });

    res.json({ success: true, data: rx });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};


/* ============================================================
   PUT /api/prescriptions/:id
============================================================ */
exports.updatePrescription = async (req, res) => {
  try {
    const { doctor, start, discount, notes } = req.body;
    const updates = {};

    if (doctor !== undefined) updates.doctor = doctor;
    if (start !== undefined) updates.start = new Date(start);
    if (discount !== undefined) updates.discount = discount;
    if (notes !== undefined) updates.notes = notes;

    if (Object.keys(updates).length === 0)
      return res.status(400).json({ success: false, message: "No valid fields to update" });

    const rx = await Prescription.findByIdAndUpdate(req.params.id, updates, { new: true })
      .populate("patient", "name patientId phone")
      .populate("meds.medicine", "name unit price");

    if (!rx) return res.status(404).json({ success: false, message: "Prescription not found" });

    res.json({ success: true, data: rx });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};


/* ============================================================
   PATCH /api/prescriptions/:id/status
============================================================ */
exports.updatePrescriptionStatus = async (req, res) => {
  try {
    const { orderStatus } = req.body;
    const valid = ["Pending", "Processing", "Packed", "Shipped", "Delivered"];

    if (!valid.includes(orderStatus))
      return res.status(400).json({ success: false, message: `Invalid status. Must be one of: ${valid.join(", ")}` });

    const rx = await Prescription.findByIdAndUpdate(req.params.id, { orderStatus }, { new: true })
      .populate("patient", "name patientId");

    if (!rx) return res.status(404).json({ success: false, message: "Prescription not found" });

    res.json({ success: true, data: rx });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};


/* ============================================================
   DELETE /api/prescriptions/:id
============================================================ */
exports.deletePrescription = async (req, res) => {
  try {
    const rx = await Prescription.findById(req.params.id).select("payStatus").lean();
    if (!rx) return res.status(404).json({ success: false, message: "Prescription not found" });

    if (rx.payStatus === "Paid")
      return res.status(400).json({ success: false, message: "Cannot delete a paid prescription" });

    await Prescription.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Prescription deleted" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};


/* ============================================================
   DELETE /api/prescriptions/cleanup
============================================================ */
exports.cleanUnusedPrescriptions = async (req, res) => {
  try {
    const unpaid = await Prescription.find({ payStatus: "Unpaid" }).select("_id").lean();
    const ids = unpaid.map((p) => p._id);

    const linkedOrders = await Order.find({ prescription: { $in: ids } }).distinct("prescription");
    const linkedSet = new Set(linkedOrders.map((id) => id.toString()));
    const toDelete = ids.filter((id) => !linkedSet.has(id.toString()));

    const result = await Prescription.deleteMany({ _id: { $in: toDelete } });

    res.json({ success: true, message: "Cleanup complete", deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};


/* ============================================================
   POST /api/prescriptions/:id/process-payment
============================================================ */
exports.processPayment = async (req, res) => {
  try {
    const rx = await Prescription.findById(req.params.id).populate("patient");
    if (!rx) return res.status(404).json({ success: false, message: "Prescription not found" });

    if (rx.payStatus === "Paid")
      return res.status(400).json({ success: false, message: "Prescription already paid" });

    rx.payStatus = "Paid";
    rx.orderStatus = "Processing";
    await rx.save();

    const existingOrder = await Order.findOne({ prescription: rx._id }).lean();
    if (existingOrder)
      return res.json({ success: true, message: "Order already exists", data: { prescription: rx, order: existingOrder } });

    const patientDoc = rx.patient;

    const order = await Order.create({
      userId: patientDoc._id.toString(),
      prescription: rx._id,
      totalAmount: rx.total,
      paymentStatus: "Paid",
      orderStatus: "Processing",
      patientDetails: {
        name: patientDoc.name,
        phone: patientDoc.phone,
        gender: patientDoc.gender || "",
        orderingFor: "admin",
      },
      addressDetails: {
        fullAddress: patientDoc.address || "",
        city: patientDoc.city || "",
        state: patientDoc.state || "",
        pincode: patientDoc.pincode || "",
      },
      deliveryAddress: patientDoc.address || "",
    });

    res.json({ success: true, message: "Payment processed & order created", data: { prescription: rx, order } });
  } catch (err) {
    console.error("Process Payment Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};


/* ============================================================
   POST /api/prescriptions/:id/renew
   Bulk stock check + bulk deduction
============================================================ */
exports.renewPrescription = async (req, res) => {
  try {
    const oldRx = await Prescription.findById(req.params.id).populate("meds.medicine");
    if (!oldRx) return res.status(404).json({ success: false, message: "Prescription not found" });

    // ── Batch stock check (single query) ──
    const medIds = oldRx.meds.map((m) => m.medicine._id || m.medicine);
    const freshMeds = await Medicine.find({ _id: { $in: medIds } }).select("_id name stock").lean();
    const stockMap = {};
    freshMeds.forEach((m) => { stockMap[m._id.toString()] = m; });

    for (const m of oldRx.meds) {
      const id = (m.medicine._id || m.medicine).toString();
      const med = stockMap[id];
      if (!med) return res.status(404).json({ success: false, message: "Medicine not found" });
      if (med.stock < m.qty) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${med.name}. Available: ${med.stock}, Required: ${m.qty}`,
        });
      }
    }

    // ── Bulk stock deduction ──
    await Medicine.bulkWrite(
      oldRx.meds.map((m) => ({
        updateOne: {
          filter: { _id: m.medicine._id || m.medicine },
          update: { $inc: { stock: -m.qty, demand30: m.qty, demand90: m.qty } },
        },
      }))
    );

    const newStart = new Date();
    const maxDur = Math.max(...oldRx.meds.map((m) => m.duration || 1));
    const newExpiry = new Date(newStart);
    newExpiry.setDate(newExpiry.getDate() + maxDur);

    const newRx = await Prescription.create({
      rxId: `RX-${Date.now()}`,
      patient: oldRx.patient,
      doctor: oldRx.doctor,
      start: newStart,
      expiry: newExpiry,
      subtotal: oldRx.subtotal,
      gst: oldRx.gst,
      discount: oldRx.discount,
      total: oldRx.total,
      payStatus: "Unpaid",
      orderStatus: "Pending",
      meds: oldRx.meds.map((m) => ({
        medicine: m.medicine._id || m.medicine,
        duration: m.duration,
        freq: m.freq,
        qty: m.qty,
        price: m.price,
        subtotal: m.subtotal,
      })),
    });

    const populated = await Prescription.findById(newRx._id)
      .populate("patient", "name patientId phone")
      .populate("meds.medicine", "name unit price");

    res.status(201).json({ success: true, message: "Prescription renewed", data: populated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
