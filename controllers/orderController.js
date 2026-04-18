const Order = require("../models/Order");
const PatientDetails = require("../models/PatientDetails");
const Address = require("../models/Address");
const Patient = require("../models/Patient");
const Medicine = require("../models/Medicine");
const Prescription = require("../models/Prescription");


const Razorpay = require("razorpay");
const crypto = require("crypto");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});


exports.createRazorpayOrder = async (req, res) => {
  try {
    const { orderId } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (order.paymentStatus === "Paid") {
      return res.json({
        success: true,
        message: "Already paid",
      });
    }

    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(order.totalAmount * 100),
      currency: "INR",
      receipt: order.orderId,
    });

    // ✅ SAVE THIS (IMPORTANT)
    order.razorpayOrderId = razorpayOrder.id;
    await order.save();

    res.json({
      success: true,
      razorpayOrder,
      amount: order.totalAmount,
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Razorpay order failed",
      error: err.message,
    });
  }
};


exports.verifyRazorpayPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderId,
    } = req.body;

    // 🔒 Step 1: Verify signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Invalid signature",
      });
    }

    // 🔍 Step 2: Find order
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // 🚫 Step 3: Prevent duplicate payment
    if (order.paymentStatus === "Paid") {
      return res.json({
        success: true,
        message: "Already paid",
        order,
      });
    }

    // 🔒 Step 4: Validate Razorpay order ID (VERY IMPORTANT)
    if (order.razorpayOrderId !== razorpay_order_id) {
      return res.status(400).json({
        success: false,
        message: "Order mismatch",
      });
    }

    // ✅ Step 5: Save payment details
    order.paymentStatus = "Paid";
    order.paymentDate = new Date();

    order.razorpayPaymentId = razorpay_payment_id;
    order.razorpaySignature = razorpay_signature;

    await order.save();

    res.json({
      success: true,
      message: "Payment successful",
      order,
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Payment verification failed",
      error: err.message,
    });
  }
};

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
    const { patientId, addressId, prescriptionId, items } = req.body;

    // ✅ VALIDATE PATIENT ID
if (!patientId) {
  return res.status(400).json({
    success: false,
    message: "patientId is required",
  });
}

const patient = await PatientDetails.findById(patientId);

if (!patient) {
  return res.status(404).json({
    success: false,
    message: "Patient not found",
  });
}

    // ✅ VALIDATE ITEMS
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No medicines provided",
      });
    }

    // ✅ VALIDATE medicineId
    for (const m of items) {
      if (!m.medicineId) {
        return res.status(400).json({
          success: false,
          message: "medicineId missing in items",
        });
      }
    }

    const userId = patient.userId;

    // 🔥 FETCH MEDICINES
    const medicineIds = items.map(i => i.medicineId);

    const medicines = await Medicine.find({
      _id: { $in: medicineIds }
    });

    const medMap = {};
    medicines.forEach(m => {
      medMap[m._id.toString()] = m;
    });

    // ✅ VALIDATE STOCK + EXISTENCE
    for (const item of items) {
      const med = medMap[item.medicineId.toString()];

      if (!med) {
        return res.status(404).json({
          success: false,
          message: "Medicine not found",
        });
      }

      if (med.stock < item.qty) {
        return res.status(400).json({
          success: false,
          message: `${med.name} only has ${med.stock} in stock`,
        });
      }
    }

    // 🔥 CALCULATE TOTAL
    const subtotal = items.reduce((sum, item) => {
      const med = medMap[item.medicineId.toString()];
      const price = Number(med.sellingPrice || 0);
      return sum + item.qty * price;
    }, 0);

    const gst = items.reduce((sum, item) => {
      const med = medMap[item.medicineId.toString()];
      const price = Number(med.sellingPrice || 0);
      const pct = med.gstPct || 12;
      return sum + (item.qty * price * pct) / 100;
    }, 0);

    const serverTotal = Math.round((subtotal + gst) * 100) / 100;

    // ✅ GET ADDRESS
 let address = null;

// ✅ 1. If addressId provided
if (addressId) {
  address = await Address.findById(addressId);
}

// ✅ 2. If not → try patient address
if (!address && patient.addressId) {
  address = await Address.findById(patient.addressId);
}

// ✅ 3. If not → fallback default
if (!address) {
  address = await Address.findOne({ userId, isDefault: true });
}

// ❌ Final validation
if (!address) {
  return res.status(400).json({
    success: false,
    message: "No address found for this patient"
  });
}

    // ✅ CREATE ORDER
    const order = await Order.create({
      userId,
      prescription: prescriptionId,
      patient: patient._id,
      orderSource: "mobile",
      totalAmount: serverTotal,

      items: items.map((item) => {
        const med = medMap[item.medicineId.toString()];
        const price = Number(med.sellingPrice || 0);

        return {
          medicineId: item.medicineId,
          name: med.name,
          qty: item.qty,
          price,
          unit: med.unit || "tablet",
          duration: item.duration || 0,
          freq: item.freq || { m: 0, a: 0, n: 0 },
          subtotal: item.qty * price,
        };
      }),

      patientDetails: {
        patientId: patient.patientId,
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

    // ✅ 🔥 DEDUCT STOCK (FIXED POSITION + SYNTAX)
    await Medicine.bulkWrite(
      items.map((item) => ({
        updateOne: {
          filter: { _id: item.medicineId },
          update: {
            $inc: {
              stock: -item.qty,
              demand30: item.qty,
              demand90: item.qty,
            },
          },
        },
      }))
    );

    // ✅ RESPONSE
    return res.status(201).json({
      success: true,
      message: "Order created successfully",
      order,
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Order creation failed",
      error: error.message,
    });
  }
};
// ============================
// BILLING TABLE  (server-side paginated)
// ============================
exports.getBillingTable = async (req, res) => {
  try {
    const { page, limit, skip, all } = paginate(req.query);
    const { search, invoiceStatus, paymentStatus, from, to } = req.query;

    // ✅ FIXED: always use queryFilter
    const queryFilter = {
      isDeleted: { $ne: true } // 🔥 important
    };

    if (invoiceStatus) queryFilter.invoiceStatus = invoiceStatus;
    if (paymentStatus) queryFilter.paymentStatus = paymentStatus;

    if (search) {
      queryFilter.$or = [
        { orderId: { $regex: search, $options: "i" } },
        { invoiceNumber: { $regex: search, $options: "i" } },
        { "patientDetails.name": { $regex: search, $options: "i" } },
      ];
    }

    if (from || to) {
      queryFilter.createdAt = {};
      if (from) queryFilter.createdAt.$gte = new Date(from);
      if (to) {
        queryFilter.createdAt.$lte = new Date(
          new Date(to).setHours(23, 59, 59, 999)
        );
      }
    }

    let q = Order.find(queryFilter)
      .select(
        "orderId invoiceNumber invoiceStatus invoiceDate paymentStatus totalAmount patientDetails createdAt items"
      )
      .sort({ createdAt: -1 })
      .lean();

    if (!all) q = q.skip(skip).limit(limit);

    const [orders, total] = await Promise.all([
      q,
      Order.countDocuments(queryFilter)
    ]);

    const table = orders.map((o) => ({
      id: o._id,
      orderId: o.orderId || "-",
      invoiceNumber:
        o.invoiceStatus === "Generated" ? o.invoiceNumber : "-",
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
    const { search, orderStatus, paymentStatus, from, to, filter } = req.query;

    const queryFilter = {
      isDeleted: { $ne: true } // ✅ prevent deleted data
    };

    if (orderStatus) queryFilter.orderStatus = orderStatus;
    if (paymentStatus) queryFilter.paymentStatus = paymentStatus;

    if (search) {
      queryFilter.$or = [
        { orderId: { $regex: search, $options: "i" } },
        { "patientDetails.name": { $regex: search, $options: "i" } },
      ];
    }

    if (from || to) {
      queryFilter.createdAt = {};
      if (from) queryFilter.createdAt.$gte = new Date(from);
      if (to) queryFilter.createdAt.$lte = new Date(
        new Date(to).setHours(23, 59, 59, 999)
      );
    }

    const now = new Date();
    const next7 = new Date();
    next7.setDate(now.getDate() + 7);

    // 🔥 STEP 1: Fetch ALL matching orders (no skip/limit yet)
    const allOrders = await Order.find(queryFilter)
      .populate({
        path: "prescription",
        match:
          filter === "active"
            ? { expiry: { $gt: next7 } }
            : filter === "expiring"
            ? { expiry: { $gt: now, $lte: next7 } }
            : filter === "expired"
            ? { expiry: { $lte: now } }
            : {},
      })
      .sort({ createdAt: -1 });

    // 🔥 STEP 2: Remove unmatched (important)
    const filteredOrders = allOrders.filter(o => o.prescription !== null);

    // 🔥 STEP 3: TOTAL (correct)
    const total = filteredOrders.length;

    // 🔥 STEP 4: Apply pagination AFTER filtering
    const paginatedOrders = all
      ? filteredOrders
      : filteredOrders.slice(skip, skip + limit);

    res.json({
      success: true,
      data: paginatedOrders,
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
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    // ✅ SOFT DELETE
    order.isDeleted = true;
    await order.save();

    res.json({
      success: true,
      message: "Order deleted successfully"
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.markPaymentPaid = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // ✅ Already paid check
    if (order.paymentStatus === "Paid") {
      return res.json({
        success: true,
        message: "Already paid",
        data: order,
      });
    }

  

    // ✅ Update payment
    order.paymentStatus = "Paid";
    order.paymentDate = new Date();

    await order.save();

    res.json({
      success: true,
      message: "Payment marked as Paid",
      data: order,
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Payment update failed",
      error: err.message,
    });
  }
};

// ============================
// ADMIN: CREATE ORDER DIRECTLY
// ============================
exports.createAdminOrder = async (req, res) => {
  try {
    const { patientId, doctor, items, address, discount = 0, notes } = req.body;

     

if (!patientId) {
  return res.status(400).json({
    success: false,
    message: "patientId is required",
  });
}

const patient = await PatientDetails.findById(patientId);

if (!patient) {
  return res.status(404).json({
    success: false,
    message: "Patient not found",
  });
}
    if (!items || !Array.isArray(items) || items.length === 0)
      return res.status(400).json({ success: false, message: "items array is required" });
    if (!address || !address.fullAddress)
      return res.status(400).json({ success: false, message: "address.fullAddress is required" });
    if (!patient) return res.status(404).json({ success: false, message: "Patient not found" });

    // ── Fetch ALL medicines in one query (not N+1) ──
    const medicineIds = items.map((i) => i.medicineId);
    const medicines = await Medicine.find({ _id: { $in: medicineIds } }).lean();

    if (medicines.length !== items.length) {
      return res.status(400).json({ success: false, message: "One or more medicines not found" });
    }

    const medMap = {};
    medicines.forEach((m) => { medMap[m._id.toString()] = m; });

  
      // 🔥 ADD THIS HERE 👇 (REPLACE OLD LOOP)

      // Merge quantities of same medicine
      const mergedItems = {};

      items.forEach(item => {
        const id = item.medicineId.toString();
        if (!mergedItems[id]) mergedItems[id] = 0;
        mergedItems[id] += item.qty;
      });

      // Validate stock
      for (const id in mergedItems) {
        const med = medMap[id];

        if (!med) {
          return res.status(404).json({
            success: false,
            message: "Medicine not found",
          });
        }

        if (med.stock < mergedItems[id]) {
          return res.status(400).json({
            success: false,
            message: `${med.name} only has ${med.stock} in stock`,
          });
        }
      }
        

    // Build prescription meds & totals
    let subtotal = 0;
    const pressMeds = items.map((item) => {
      const med = medMap[item.medicineId.toString()];
      const freq = item.freq || { m: 1, a: 0, n: 1 };
      const duration = item.duration || 5;
      const qty = item.qty ?? (freq.m + freq.a + freq.n) * duration;
      const price = Number(med.sellingPrice || 0);
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



    const order = await Order.create({
      userId: patient.userId,
      prescription: prescription._id,
      patient: patient._id,
orderSource: "admin",
      totalAmount: total,
      patientDetails: {
        name: patient.name,
        patientId: patient.patientId, // ✅ ADD THIS
        phone: patient.primaryPhone,
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

// 🔥 DEDUCT STOCK (ADD THIS)
await Medicine.bulkWrite(
  Object.entries(mergedItems).map(([id, qty]) => ({
    updateOne: {
      filter: { _id: id },
      update: {
        $inc: {
          stock: -qty,
          demand30: qty,
          demand90: qty,
        },
      },
    },
  }))
);

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


exports.updatePaymentStatus = async (req, res) => {
  try {
    const { status } = req.body;

    const validStatuses = ["Pending", "Paid", "Failed", "Refunded"];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment status",
      });
    }

    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // 🚫 Prevent Paid → Pending (important)
    if (order.paymentStatus === "Paid" && status === "Pending") {
      return res.status(400).json({
        success: false,
        message: "Cannot revert Paid to Pending. Use refund instead.",
      });
    }

    // ✅ Update status
    order.paymentStatus = status;

    if (status === "Paid") {
      order.paymentDate = new Date();
    }

    if (status === "Refunded") {
      order.paymentDate = null;
    }

    await order.save();

    res.json({
      success: true,
      message: "Payment status updated",
      data: order,
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Update failed",
      error: err.message,
    });
  }
};