const router = require("express").Router();
const controller = require("../controllers/dashboardController");

/* Core KPIs — patients, prescriptions, orders, inventory, revenue */
router.get("/summary", controller.getDashboardSummary);

/* Recent activity feed — last N orders & prescriptions */
router.get("/activity", controller.getRecentActivity);

/* Monthly trends — revenue, orders, new patients (last 6 months by default) */
router.get("/trends", controller.getTrends);

module.exports = router;
