const Medicine = require("../models/Medicine");
const Patient = require("../models/Patient");
const Prescription = require("../models/Prescription");
const Order = require("../models/Order");

/* ============================================================
   HELPER: start of day / end of day
============================================================ */
function dayRange(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/* ============================================================
   GET /api/dashboard/summary
   Optimized: aggregation pipelines instead of loading all docs,
   .lean() on read-only queries, parallel execution
============================================================ */
exports.getDashboardSummary = async (req, res) => {
  try {
    const today = new Date();
    const { start: todayStart, end: todayEnd } = dayRange(today);
    const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);

    const now = new Date();
    const next7 = new Date();
    next7.setDate(now.getDate() + 7);

    /* ── Run ALL aggregations in parallel ── */
    const [
      patientCounts,
      orderAgg,
      revenueAggs,
      inventoryAgg,
      expiryItems,
      topMedsAgg,
      // 🔥 NEW: prescription counts
      totalPrescriptions,
      activePrescriptions,
      expiringPrescriptions,
      expiredPrescriptions
    ] = await Promise.all([

      // ── PATIENTS ──
      Promise.all([
        Patient.countDocuments(),
        Patient.countDocuments({ createdAt: { $gte: thisMonthStart } }),
        Patient.countDocuments({ createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd } }),
      ]),

      // ❌ REMOVED rxAgg (WRONG LOGIC)

      // ── ORDERS ──
      Order.aggregate([
        {
          $facet: {
            byStatus: [{ $group: { _id: "$orderStatus", count: { $sum: 1 } } }],
            byPayment: [{ $group: { _id: "$paymentStatus", count: { $sum: 1 } } }],
            today: [
              { $match: { createdAt: { $gte: todayStart, $lte: todayEnd } } },
              { $count: "count" },
            ],
          },
        },
      ]),

      // ── REVENUE ──
      Order.aggregate([
        { $match: { paymentStatus: "Paid" } },
        {
          $facet: {
            total: [{ $group: { _id: null, sum: { $sum: "$totalAmount" } } }],
            today: [
              { $match: { createdAt: { $gte: todayStart, $lte: todayEnd } } },
              { $group: { _id: null, sum: { $sum: "$totalAmount" } } },
            ],
            thisMonth: [
              { $match: { createdAt: { $gte: thisMonthStart } } },
              { $group: { _id: null, sum: { $sum: "$totalAmount" } } },
            ],
            lastMonth: [
              { $match: { createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd } } },
              { $group: { _id: null, sum: { $sum: "$totalAmount" } } },
            ],
          },
        },
      ]),

      // ── INVENTORY ──
      Medicine.aggregate([
        {
          $facet: {
            total: [{ $count: "count" }],
            active: [{ $match: { status: "Active" } }, { $count: "count" }],
            outOfStock: [{ $match: { stock: 0 } }, { $count: "count" }],
            critical: [
              { $match: { $expr: { $and: [{ $gt: ["$stock", 0] }, { $lte: ["$stock", { $multiply: ["$minStock", 0.5] }] }] } } },
              { $count: "count" },
            ],
            lowStock: [
              { $match: { $expr: { $and: [{ $gt: ["$stock", { $multiply: ["$minStock", 0.5] }] }, { $lte: ["$stock", "$minStock"] }] } } },
              { $count: "count" },
            ],
            inStock: [
              { $match: { $expr: { $gt: ["$stock", "$minStock"] } } },
              { $count: "count" },
            ],
          },
        },
      ]),

      // ── EXPIRY ITEMS ──
      Medicine.find({ expiry: { $exists: true, $ne: null } })
        .select("name expiry stock")
        .sort({ expiry: 1 })
        .limit(20)
        .lean(),

      // ── TOP MEDS ──
      Medicine.find({ demand30: { $gt: 0 } })
        .select("name demand30 demand90 stock price")
        .sort({ demand30: -1 })
        .limit(5)
        .lean(),

      // 🔥 PRESCRIPTION COUNTS (CORRECT LOGIC)
      Prescription.countDocuments({
      expiry: { $exists: true }
    }),

      Prescription.countDocuments({
        expiry: { $exists: true, $gt: next7 }
      }),

      Prescription.countDocuments({
        expiry: { $gt: now, $lte: next7 }
      }),

      Prescription.countDocuments({
        expiry: { $lte: now }
      }),
    ]);

    /* ── Patients ── */
    const [totalPatients, newPatientsThisMonth, newPatientsLastMonth] = patientCounts;

    /* ── Orders ── */
    const ordData = orderAgg[0];
    const ordByStatus = {};
    ordData.byStatus.forEach((s) => { ordByStatus[s._id] = s.count; });
    const ordByPay = {};
    ordData.byPayment.forEach((s) => { ordByPay[s._id] = s.count; });
    const totalOrders = Object.values(ordByStatus).reduce((a, b) => a + b, 0);

    /* ── Revenue ── */
    const revData = revenueAggs[0];
    const totalRevenue = revData.total[0]?.sum || 0;

    /* ── Inventory ── */
    const inv = inventoryAgg[0];
    const totalSKUs = inv.total[0]?.count || 0;

    /* ── FINAL RESPONSE ── */
    res.json({
      patients: {
        total: totalPatients,
      },

      prescriptions: {
        total: totalPrescriptions,
        active: activePrescriptions,
        expiring: expiringPrescriptions,
        expired: expiredPrescriptions,
      },

      orders: {
        total: totalOrders,
        pending: ordByStatus["Created"] || 0,
        processing: ordByStatus["Processing"] || 0,
        packed: ordByStatus["Packed"] || 0,
        shipped: ordByStatus["Shipped"] || 0,
        delivered: ordByStatus["Delivered"] || 0,
        paid: ordByPay["Paid"] || 0,
      },

      revenue: {
        total: totalRevenue,
      },

      inventory: {
        totalSKUs,
      },
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ============================================================
   GET /api/dashboard/activity
============================================================ */
exports.getRecentActivity = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;

    const [recentOrders, recentPrescriptions] = await Promise.all([
      Order.find()
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate({ path: "prescription", select: "rxId doctor total" })
        .select("orderId invoiceNumber orderStatus paymentStatus totalAmount patientDetails createdAt")
        .lean(),

      Prescription.find()
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate({ path: "patient", select: "name patientId phone" })
        .select("rxId doctor total payStatus orderStatus createdAt")
        .lean(),
    ]);

    res.json({ recentOrders, recentPrescriptions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ============================================================
   GET /api/dashboard/trends
============================================================ */
exports.getTrends = async (req, res) => {
  try {
    const months = Math.min(parseInt(req.query.months) || 6, 12);
    const today = new Date();

    const buckets = [];
    for (let i = months - 1; i >= 0; i--) {
      const start = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const end = new Date(today.getFullYear(), today.getMonth() - i + 1, 0, 23, 59, 59, 999);
      buckets.push({
        label: start.toLocaleString("default", { month: "short", year: "2-digit" }),
        start,
        end,
      });
    }

    const dateRange = { $gte: buckets[0].start, $lte: buckets[buckets.length - 1].end };

    // Single aggregation for both revenue + order counts
    const [orderTrends, patientTrend] = await Promise.all([
      Order.aggregate([
        { $match: { createdAt: dateRange } },
        {
          $group: {
            _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
            revenue: {
              $sum: { $cond: [{ $eq: ["$paymentStatus", "Paid"] }, "$totalAmount", 0] },
            },
            orders: { $sum: 1 },
          },
        },
      ]),
      Patient.aggregate([
        { $match: { createdAt: dateRange } },
        {
          $group: {
            _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const orderMap = {};
    orderTrends.forEach((r) => { orderMap[`${r._id.year}-${r._id.month}`] = r; });
    const patientMap = {};
    patientTrend.forEach((r) => { patientMap[`${r._id.year}-${r._id.month}`] = r.count; });

    const trends = buckets.map((b) => {
      const key = `${b.start.getFullYear()}-${b.start.getMonth() + 1}`;
      const ord = orderMap[key] || {};
      return {
        month: b.label,
        revenue: ord.revenue || 0,
        orders: ord.orders || 0,
        patients: patientMap[key] || 0,
      };
    });

    res.json({ trends });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
