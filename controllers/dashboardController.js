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
    const lastMonthEnd   = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);

    /* ── Run ALL aggregations in parallel ── */
    const [
      patientCounts,
      rxAgg,
      orderAgg,
      revenueAggs,
      inventoryAgg,
      expiryItems,
      topMedsAgg,
    ] = await Promise.all([

      // ── PATIENTS: 3 counts in parallel via Promise.all ──
      Promise.all([
        Patient.countDocuments(),
        Patient.countDocuments({ createdAt: { $gte: thisMonthStart } }),
        Patient.countDocuments({ createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd } }),
      ]),

      // ── PRESCRIPTIONS: single aggregation for all counts ──
      Prescription.aggregate([
        {
          $facet: {
            byOrderStatus: [{ $group: { _id: "$orderStatus", count: { $sum: 1 } } }],
            byPayStatus: [{ $group: { _id: "$payStatus", count: { $sum: 1 } } }],
            today: [
              { $match: { createdAt: { $gte: todayStart, $lte: todayEnd } } },
              { $count: "count" },
            ],
          },
        },
      ]),

      // ── ORDERS: single aggregation with $facet ──
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

      // ── REVENUE: single aggregation with $facet ──
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

      // ── INVENTORY: aggregation for stock stats instead of loading all docs ──
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
            reorderCost: [
              { $match: { $expr: { $lt: ["$stock", "$minStock"] } } },
              { $group: { _id: null, cost: { $sum: { $multiply: [{ $subtract: ["$minStock", "$stock"] }, { $ifNull: ["$price", 0] }] } } } },
            ],
            inventoryValue: [
              { $group: { _id: null, value: { $sum: { $multiply: ["$stock", { $ifNull: ["$price", 0] }] } } } },
            ],
          },
        },
      ]),

      // ── EXPIRY: only fetch medicines with expiry, limited fields ──
      Medicine.find({ expiry: { $exists: true, $ne: null } })
        .select("name expiry stock")
        .sort({ expiry: 1 })
        .limit(20)
        .lean(),

      // ── TOP MEDICINES by demand ──
      Medicine.find({ demand30: { $gt: 0 } })
        .select("name demand30 demand90 stock price")
        .sort({ demand30: -1 })
        .limit(5)
        .lean(),
    ]);

    /* ── Parse patient counts ── */
    const [totalPatients, newPatientsThisMonth, newPatientsLastMonth] = patientCounts;
    const patientGrowthPct = newPatientsLastMonth === 0
      ? (newPatientsThisMonth > 0 ? 100 : 0)
      : Math.round(((newPatientsThisMonth - newPatientsLastMonth) / newPatientsLastMonth) * 100);

    /* ── Parse prescription aggregation ── */
    const rxData = rxAgg[0];
    const rxByOrder = {};
    rxData.byOrderStatus.forEach((s) => { rxByOrder[s._id] = s.count; });
    const rxByPay = {};
    rxData.byPayStatus.forEach((s) => { rxByPay[s._id] = s.count; });
    const totalPrescriptions = Object.values(rxByOrder).reduce((a, b) => a + b, 0);

    /* ── Parse order aggregation ── */
    const ordData = orderAgg[0];
    const ordByStatus = {};
    ordData.byStatus.forEach((s) => { ordByStatus[s._id] = s.count; });
    const ordByPay = {};
    ordData.byPayment.forEach((s) => { ordByPay[s._id] = s.count; });
    const totalOrders = Object.values(ordByStatus).reduce((a, b) => a + b, 0);

    /* ── Parse revenue ── */
    const revData = revenueAggs[0];
    const totalRevenue = revData.total[0]?.sum || 0;
    const todayRevenue = revData.today[0]?.sum || 0;
    const monthRevenue = revData.thisMonth[0]?.sum || 0;
    const lastMonthRevenue = revData.lastMonth[0]?.sum || 0;
    const revenueGrowthPct = lastMonthRevenue === 0
      ? (monthRevenue > 0 ? 100 : 0)
      : Math.round(((monthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100);

    /* ── Parse inventory aggregation ── */
    const inv = inventoryAgg[0];
    const totalSKUs = inv.total[0]?.count || 0;
    const activeSKUs = inv.active[0]?.count || 0;
    const outOfStock = inv.outOfStock[0]?.count || 0;
    const criticalStock = inv.critical[0]?.count || 0;
    const lowStockItems = inv.lowStock[0]?.count || 0;
    const inStockItems = inv.inStock[0]?.count || 0;
    const reorderCost = Math.round((inv.reorderCost[0]?.cost || 0) * 100) / 100;
    const totalInventoryValue = Math.round((inv.inventoryValue[0]?.value || 0) * 100) / 100;

    /* ── Expiry risk (computed from lean docs) ── */
    const expiryRisk = expiryItems.map((m) => {
      const diffDays = (new Date(m.expiry) - today) / (1000 * 60 * 60 * 24);
      let risk = "LOW";
      if (diffDays < 0) risk = "EXPIRED";
      else if (diffDays < 30) risk = "HIGH";
      else if (diffDays < 90) risk = "MEDIUM";
      return { name: m.name, expiry: m.expiry, stock: m.stock, risk, remainingDays: Math.floor(diffDays) };
    });
    const expiredCount = expiryRisk.filter((m) => m.risk === "EXPIRED").length;
    const highRiskCount = expiryRisk.filter((m) => m.risk === "HIGH").length;

    /* ── Graph data: top 15 by demand (lean query) ── */
    const graphData = await Medicine.find({ $or: [{ demand30: { $gt: 0 } }, { stock: { $gt: 0 } }] })
      .select("name demand30 stock")
      .sort({ demand30: -1 })
      .limit(15)
      .lean();

    /* ── Fetch medicines only when needed by Inventory (paginated separately) ── */
    // For backward compat, still include medicines array but with lean()
    const medicines = await Medicine.find().sort({ createdAt: -1 }).lean();
    // Manually add virtuals for lean docs
    medicines.forEach((m) => {
      m.stockStatus = m.stock === 0 ? "Out of Stock" : m.stock <= m.minStock ? "Low Stock" : "In Stock";
      m.autoReorderQty = m.stock >= m.minStock ? 0 : m.minStock + 20 - m.stock;
      const dailyUsage = (m.demand30 || 0) / 30;
      m.daysUntilStockout = dailyUsage === 0 ? "∞" : Math.floor(m.stock / dailyUsage);
      m.profitPerUnit = (m.sellingPrice || 0) - (m.costPrice || 0);
      m.profitMargin = !m.sellingPrice ? 0 : Math.round(((m.sellingPrice - (m.costPrice || 0)) / m.sellingPrice) * 100);
    });

    /* ── RESPONSE ── */
    res.json({
      medicines,
      totalSKUs,
      criticalStock,
      lowStockItems,
      outOfStock,
      patients: {
        total: totalPatients,
        newThisMonth: newPatientsThisMonth,
        newLastMonth: newPatientsLastMonth,
        growthPct: patientGrowthPct,
      },
      prescriptions: {
        total: totalPrescriptions,
        pending: rxByOrder["Pending"] || 0,
        paid: rxByPay["Paid"] || 0,
        unpaid: rxByPay["Unpaid"] || 0,
        today: rxData.today[0]?.count || 0,
      },
      orders: {
        total: totalOrders,
        today: ordData.today[0]?.count || 0,
        pending: ordByStatus["Created"] || 0,
        processing: ordByStatus["Processing"] || 0,
        packed: ordByStatus["Packed"] || 0,
        shipped: ordByStatus["Shipped"] || 0,
        delivered: ordByStatus["Delivered"] || 0,
        paid: ordByPay["Paid"] || 0,
      },
      revenue: {
        total: totalRevenue,
        today: todayRevenue,
        thisMonth: monthRevenue,
        lastMonth: lastMonthRevenue,
        growthPct: revenueGrowthPct,
      },
      inventory: {
        totalSKUs,
        activeSKUs,
        outOfStock,
        criticalStock,
        lowStockItems,
        inStockItems,
        reorderCost,
        totalInventoryValue,
        expiredCount,
        highRiskCount,
      },
      graphData: graphData.map((m) => ({ name: m.name, demand: m.demand30 || 0, stock: m.stock })),
      topMedicines: topMedsAgg.map((m) => ({ name: m.name, demand30: m.demand30, demand90: m.demand90, stock: m.stock, price: m.price })),
      expiryRisk: expiryRisk.slice(0, 10),
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
