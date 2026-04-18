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
      const now = new Date();
      const next7 = new Date();
      next7.setDate(now.getDate() + 7);

      const [total, active, expiring, expired] = await Promise.all([
        // Total (only valid expiry records)
        Prescription.countDocuments({
          expiry: { $exists: true }
        }),

        // Active (> 7 days)
        Prescription.countDocuments({
          expiry: { $exists: true, $gt: next7 }
        }),

        // Expiring (0–7 days)
        Prescription.countDocuments({
          expiry: { $exists: true, $gt: now, $lte: next7 }
        }),

        // Expired
        Prescription.countDocuments({
          expiry: { $exists: true, $lte: now }
        }),
      ]);

      res.json({
        success: true,
        data: {
          total,
          active,
          expiring,
          expired,
        },
      });

    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  };

  /* ============================================================
    POST /api/prescriptions
    Create prescription — bulk stock deduction
  ============================================================ */
  exports.createPrescription = async (req, res) => {
    try {
      const {  doctor, start, discount = 0, meds } = req.body;

      if ( !doctor || !start)
        return res.status(400).json({ success: false, message: " doctor and start date are required" });
      if (!meds || meds.length === 0)
        return res.status(400).json({ success: false, message: "No medicines provided" });


      let built;
      try {
        built = await buildMeds(meds, discount, true);
      } catch (msg) {
        return res.status(400).json({ success: false, message: msg });
      }

      const { processedMeds, subtotal, gst, total, maxDuration } = built;

      // ── Bulk stock deduction ──


      const start_d = new Date(start);
      const expiryDate = new Date(start_d);
      expiryDate.setDate(expiryDate.getDate() + maxDuration);

      const rx = await Prescription.create({
        rxId: `RX-${Date.now()}`,
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
      const { payStatus, orderStatus, search, from, to } = req.query;
      const filterQuery = {};
      const { filter } = req.query;

      const now = new Date();
      const next7 = new Date();
      next7.setDate(now.getDate() + 7);

      if (filter === "active") {
        filterQuery.expiry = { $gt: next7 };
      } else if (filter === "expiring") {
        filterQuery.expiry = { $gt: now, $lte: next7 };
      } else if (filter === "expired") {
        filterQuery.expiry = { $lte: now };
      }

      if (payStatus) filterQuery.payStatus = payStatus;
      if (orderStatus) filterQuery.orderStatus = orderStatus;
      

      if (from || to) {
        filterQuery.createdAt = {};
        if (from) filterQuery.createdAt.$gte = new Date(from);
        if (to) filterQuery.createdAt.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
      }



      let q = Prescription.find({
        ...filterQuery,
        expiry: { $exists: true }
      })

        .populate("meds.medicine", "name unit price category")
        .sort({ createdAt: -1 });

      if (!all) q = q.skip(skip).limit(limit);

        const finalFilter = {
        ...filterQuery,
        expiry: { $exists: true }
      };

      const [results, total] = await Promise.all([
        Prescription.find(finalFilter)
          .populate("meds.medicine", "name unit price category")
          .sort({ createdAt: -1 })
          .skip(all ? 0 : skip)
          .limit(all ? 0 : limit),

        Prescription.countDocuments(finalFilter)
      ]);

      
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

      const rx = await Prescription.findByIdAndUpdate(req.params.id, { orderStatus }, { new: true });

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
      const rx = await Prescription.findById(req.params.id)
        .populate("meds.medicine"); // 🔥 IMPORTANT (for name, price)

      if (!rx) {
        return res.status(404).json({
          success: false,
          message: "Prescription not found",
        });
      }

      if (rx.payStatus === "Paid") {
        return res.status(400).json({
          success: false,
          message: "Prescription already paid",
        });
      }

      const { patientId } = req.body;

      const patientDoc = await Patient.findById(patientId);

      // ✅ FIX 1: Patient validation
      if (!patientDoc) {
        return res.status(404).json({
          success: false,
          message: "Patient not found",
        });
      }

      // ✅ Check if order already exists
      const existingOrder = await Order.findOne({ prescription: rx._id }).lean();
      if (existingOrder) {
        return res.json({
          success: true,
          message: "Order already exists",
          data: { prescription: rx, order: existingOrder },
        });
      }

      // 🔥 FIX 2: STOCK DEDUCTION AFTER PAYMENT
      await Medicine.bulkWrite(
        rx.meds.map((m) => ({
          updateOne: {
            filter: { _id: m.medicine._id },
            update: {
              $inc: {
                stock: -m.qty,
                demand30: m.qty,
                demand90: m.qty,
              },
            },
          },
        }))
      );

      // 🔥 FIX 3: UPDATE PRESCRIPTION STATUS
      rx.payStatus = "Paid";
      rx.orderStatus = "Processing";
      await rx.save();

      // 🔥 FIX 4: INCLUDE ITEMS IN ORDER
      const order = await Order.create({
        userId: patientDoc._id.toString(),
        prescription: rx._id,
        totalAmount: rx.total,
        paymentStatus: "Paid",
        orderStatus: "Processing",

        items: rx.meds.map((m) => ({
          medicineId: m.medicine._id,
          name: m.medicine.name,
          qty: m.qty,
          price: m.price,
          unit: m.medicine.unit || "tablet",
        })),

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

      return res.json({
        success: true,
        message: "Payment processed & order created",
        data: {
          prescription: rx,
          order,
        },
      });

    } catch (err) {
      console.error("Process Payment Error:", err);
      return res.status(500).json({
        success: false,
        message: "Payment processing failed",
        error: err.message,
      });
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
      
        .populate("meds.medicine", "name unit price");

      res.status(201).json({ success: true, message: "Prescription renewed", data: populated });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  };
