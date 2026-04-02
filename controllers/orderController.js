const Order = require("../models/Order");
const PatientDetails = require("../models/PatientDetails");
const Address = require("../models/Address");
const Patient = require("../models/Patient");
const Medicine = require("../models/Medicine");
const Prescription = require("../models/Prescription");

/* ── pagination helper ───────────────────────────────────────── */
function paginate(query) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const raw = parseInt(query.limit);
  const all = raw === 0;                       // limit=0 → return everything (exports)
  const limit = all ? 0 : Math.min(Math.max(raw || 10, 1), 100);
  const skip = all ? 0 : (page - 1) * limit;
  return { page, limit, skip, all };
}

exports.createOrder = async (req, res) => {
  try {
    const { patientId, addressId, prescriptionId, totalAmount, imageUri, pharmacistReview } = req.body;

    if (!patientId) {
      return res.status(400).json({ success: false, message: "Patient is required" });
    }

    const patient = await PatientDetails.findById(patientId);
    if (!patient) return res.status(404).json({ success: false, message: "Patient not found" });

    const userId = patient.userId;

    let address = addressId
      ? await Address.findById(addressId)
      : await Address.findOne({ userId, isDefault: true });

    if (!address) return res.status(400).json({ success: false, message: "Address not found" });

    // Check if prescriptionId is a valid ObjectId
    const mongoose = require("mongoose");
    const validRxId = prescriptionId && mongoose.Types.ObjectId.isValid(prescriptionId);

    // Server-side price calculation if prescription exists
    let serverTotal = totalAmount || 0;
    if (validRxId) {
      try {
        const rx = await Prescription.findById(prescriptionId).populate("meds.medicine");
        if (rx && rx.meds?.length > 0) {
          const subtotal = rx.meds.reduce((s, m) => s + (m.subtotal || 0), 0);
          const gst = subtotal * 0.12;
          serverTotal = Math.round((subtotal + gst) * 100) / 100;
        }
      } catch {}
    }

    const order = await Order.create({
      userId,
      prescription: validRxId ? prescriptionId : undefined,
      patient: patient._id,
      totalAmount: serverTotal,
      pharmacistReview: !validRxId,
      patientDetails: {
        name: patient.name,
        phone: patient.primaryPhone,
        secondaryPhone: patient.secondaryPhone || "",
        gender: patient.gender,
        orderingFor: patient.orderingFor || "myself",
      },
      addressDetails: {
        fullAddress: address.fullAddress,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
      },
      deliveryAddress: address.fullAddress,
    });

    res.status(201).json({ success: true, message: "Order placed successfully", order });
  } catch (error) {
    res.status(500).json({ success: false, message: "Order creation failed", error: error.message });
  }
};


// ============================
// BILLING TABLE  (server-side paginated)
// ============================
exports.getBillingTable = async (req, res) => {
  try {
    const { page, limit, skip, all } = paginate(req.query);
    const { search, invoiceStatus, paymentStatus, from, to } = req.query;

    const filter = {};
    if (invoiceStatus) filter.invoiceStatus = invoiceStatus;
    if (paymentStatus) filter.paymentStatus = paymentStatus;

    if (search) {
      filter.$or = [
        { orderId: { $regex: search, $options: "i" } },
        { invoiceNumber: { $regex: search, $options: "i" } },
        { "patientDetails.name": { $regex: search, $options: "i" } },
      ];
    }

    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }

    let q = Order.find(filter)
      .select("orderId invoiceNumber invoiceStatus invoiceDate paymentStatus totalAmount patientDetails createdAt")
      .sort({ createdAt: -1 })
      .lean();

    if (!all) q = q.skip(skip).limit(limit);

    const [orders, total] = await Promise.all([q, Order.countDocuments(filter)]);

    const table = orders.map((o) => ({
      id: o._id,
      orderId: o.orderId || "-",
      invoiceNumber: o.invoiceStatus === "Generated" ? o.invoiceNumber : "-",
      invoiceDate: o.invoiceDate || "-",
      customerName: o.patientDetails?.name || "Unknown",
      billAmount: o.totalAmount || 0,
      invoiceStatus: o.invoiceStatus,
      paymentStatus: o.paymentStatus,
    }));

    res.json({
      success: true,
      data: table,
      pagination: {
        page: all ? 1 : page,
        limit: all ? total : limit,
        total,
        totalPages: all ? 1 : Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ============================
// GET ALL ORDERS  (server-side paginated)
// ============================
exports.getOrders = async (req, res) => {
  try {
    const { page, limit, skip, all } = paginate(req.query);
    const { search, orderStatus, paymentStatus, from, to } = req.query;

    const filter = {};
    if (orderStatus) filter.orderStatus = orderStatus;
    if (paymentStatus) filter.paymentStatus = paymentStatus;

    if (search) {
      filter.$or = [
        { orderId: { $regex: search, $options: "i" } },
        { "patientDetails.name": { $regex: search, $options: "i" } },
      ];
    }

    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }

    let q = Order.find(filter)
      .populate({ path: "prescription", populate: { path: "meds.medicine" } })
      .sort({ createdAt: -1 });

    if (!all) q = q.skip(skip).limit(limit);

    const [orders, total] = await Promise.all([q, Order.countDocuments(filter)]);

    res.json({
      success: true,
      data: orders,
      pagination: {
        page: all ? 1 : page,
        limit: all ? total : limit,
        total,
        totalPages: all ? 1 : Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ============================
// GET SINGLE ORDER
// ============================
exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate({ path: "prescription", populate: { path: "meds.medicine" } })
      .populate("patient");

    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ============================
// GENERATE INVOICE
// ============================
exports.generateInvoice = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    if (order.invoiceStatus === "Generated") {
      return res.json({ success: true, message: "Invoice already generated", order });
    }

    order.invoiceStatus = "Generated";
    order.invoiceDate = new Date();
    await order.save();

    res.json({ success: true, message: "Invoice generated successfully", order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ============================
// DELETE ORDER
// ============================
exports.deleteOrder = async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    res.json({ success: true, message: "Order deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.markPaymentPaid = async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { paymentStatus: "Paid", paymentDate: new Date() },
      { new: true }
    );
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    res.json({ success: true, message: "Payment marked as Paid", data: order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ============================
// ADMIN: CREATE ORDER DIRECTLY
// ============================
exports.createAdminOrder = async (req, res) => {
  try {
    const { patientId, doctor, items, address, discount = 0, notes } = req.body;

    if (!patientId) return res.status(400).json({ success: false, message: "patientId is required" });
    if (!items || !Array.isArray(items) || items.length === 0)
      return res.status(400).json({ success: false, message: "items array is required" });
    if (!address || !address.fullAddress)
      return res.status(400).json({ success: false, message: "address.fullAddress is required" });

    const patient = await Patient.findById(patientId).lean();
    if (!patient) return res.status(404).json({ success: false, message: "Patient not found" });

    // ── Fetch ALL medicines in one query (not N+1) ──
    const medicineIds = items.map((i) => i.medicineId);
    const medicines = await Medicine.find({ _id: { $in: medicineIds } }).lean();

    if (medicines.length !== items.length) {
      return res.status(400).json({ success: false, message: "One or more medicines not found" });
    }

    const medMap = {};
    medicines.forEach((m) => { medMap[m._id.toString()] = m; });

    // Stock check
    for (const item of items) {
      const med = medMap[item.medicineId];
      if (!med) return res.status(404).json({ success: false, message: `Medicine ${item.medicineId} not found` });
      if (med.stock < item.qty) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${med.name}. Available: ${med.stock}, Requested: ${item.qty}`,
        });
      }
    }

    // Build prescription meds & totals
    let subtotal = 0;
    const pressMeds = items.map((item) => {
      const med = medMap[item.medicineId];
      const freq = item.freq || { m: 1, a: 0, n: 1 };
      const duration = item.duration || 5;
      const qty = item.qty ?? (freq.m + freq.a + freq.n) * duration;
      const price = med.price || 0;
      const itemSub = qty * price;
      subtotal += itemSub;
      return { medicine: med._id, duration, freq, qty, price, subtotal: itemSub };
    });

    const avgGstPct = medicines.reduce((sum, m) => sum + (m.gstPct || 12), 0) / medicines.length;
    const gst = Math.round(subtotal * (avgGstPct / 100) * 100) / 100;
    const total = Math.round((subtotal + gst - discount) * 100) / 100;

    const start = new Date();
    const maxDur = Math.max(...items.map((i) => i.duration || 5));
    const expiry = new Date(start);
    expiry.setDate(expiry.getDate() + maxDur);

    const prescription = await Prescription.create({
      rxId: "RX-ADM-" + Date.now(),
      patient: patient._id,
      doctor: doctor || "Admin Order",
      start,
      expiry,
      meds: pressMeds,
      subtotal,
      gst,
      discount,
      total,
      payStatus: "Paid",
      orderStatus: "Processing",
      ...(notes ? { notes } : {}),
    });

    // ── Bulk stock deduction (not N+1 loop) ──
    await Medicine.bulkWrite(
      items.map((item) => ({
        updateOne: {
          filter: { _id: item.medicineId },
          update: { $inc: { stock: -item.qty, demand30: item.qty, demand90: item.qty } },
        },
      }))
    );

    const order = await Order.create({
      userId: patient._id.toString(),
      prescription: prescription._id,
      totalAmount: total,
      patientDetails: {
        name: patient.name,
        phone: patient.phone,
        gender: patient.gender || "",
        orderingFor: "admin",
      },
      addressDetails: {
        fullAddress: address.fullAddress,
        city: address.city || "",
        state: address.state || "",
        pincode: address.pincode || "",
      },
      deliveryAddress: address.fullAddress,
      paymentStatus: "Paid",
      orderStatus: "Processing",
    });

    const populated = await Order.findById(order._id).populate({
      path: "prescription",
      populate: { path: "meds.medicine", select: "name unit price" },
    });

    res.status(201).json({ success: true, message: "Order created successfully", data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: "Order creation failed", error: err.message });
  }
};


// ============================
// UPDATE ORDER STATUS
// ============================
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ["Created", "Processing", "Packed", "Shipped", "Delivered"];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const order = await Order.findByIdAndUpdate(req.params.id, { orderStatus: status }, { new: true });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
