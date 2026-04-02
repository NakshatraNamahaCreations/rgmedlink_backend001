const express = require("express");
const router = express.Router();

const {
  createOrder,
  createAdminOrder,
  getBillingTable,
  getOrders,
  getOrderById,
  generateInvoice,
  updateOrderStatus,
  deleteOrder,
  markPaymentPaid,
} = require("../controllers/orderController");

// ADMIN: CREATE ORDER DIRECTLY (patient + medicines + address in one shot)
router.post("/admin-create", createAdminOrder);

// CREATE ORDER (customer flow — requires existing prescription)
router.post("/create", createOrder);

// BILLING TABLE
router.get("/billing", getBillingTable);

// GET ALL ORDERS
router.get("/", getOrders);

// GET SINGLE ORDER
router.get("/:id", getOrderById);
// ADD THIS 👇
router.patch("/:id/pay", markPaymentPaid);
// GENERATE INVOICE
router.patch("/:id/invoice", generateInvoice);

router.delete("/:id", deleteOrder);
// UPDATE STATUS
router.patch("/:id/status", updateOrderStatus);

// DOWNLOAD INVOICE PDF
router.get("/:id/invoice-pdf", async (req, res) => {
  try {
    const Order = require("../models/Order");
    const PDFDocument = require("pdfkit");

    const order = await Order.findById(req.params.id).populate("prescription");
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    const rx = order.prescription;
    const meds = rx?.meds || [];

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=invoice-${order.orderId}.pdf`);
    doc.pipe(res);

    // Header
    doc.fontSize(24).font("Helvetica-Bold").fillColor("#7F0E25").text("RG Medlink", { align: "center" });
    doc.fontSize(10).font("Helvetica").fillColor("#666").text("Your Health, Delivered", { align: "center" });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#E2E8F0").stroke();
    doc.moveDown(1);

    // Invoice details
    doc.fontSize(16).font("Helvetica-Bold").fillColor("#000").text("TAX INVOICE");
    doc.moveDown(0.5);
    doc.fontSize(10).font("Helvetica").fillColor("#333");
    doc.text(`Invoice No: ${order.invoiceNumber || order.orderId}`);
    doc.text(`Order ID: ${order.orderId}`);
    doc.text(`Date: ${new Date(order.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}`);
    doc.text(`Payment: ${order.paymentStatus || "Pending"}`);
    doc.moveDown(1);

    // Patient & Address
    doc.fontSize(12).font("Helvetica-Bold").text("Bill To:");
    doc.fontSize(10).font("Helvetica").fillColor("#333");
    doc.text(`${order.patientDetails?.name || "Patient"}`);
    doc.text(`Phone: ${order.patientDetails?.phone || "—"}`);
    doc.text(`Address: ${order.deliveryAddress || "—"}`);
    doc.moveDown(1);

    // Table header
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#7F0E25").lineWidth(1).stroke();
    doc.moveDown(0.3);
    const tableTop = doc.y;
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#7F0E25");
    doc.text("Medicine", 50, tableTop, { width: 200 });
    doc.text("Freq", 250, tableTop, { width: 60 });
    doc.text("Days", 310, tableTop, { width: 40 });
    doc.text("Qty", 350, tableTop, { width: 40 });
    doc.text("Price", 390, tableTop, { width: 60 });
    doc.text("Amount", 460, tableTop, { width: 80, align: "right" });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#E2E8F0").stroke();
    doc.moveDown(0.3);

    // Medicine rows
    doc.fontSize(9).font("Helvetica").fillColor("#333");
    meds.forEach((m) => {
      const y = doc.y;
      const name = m.medicine?.name || "Medicine";
      const freq = `${m.freq?.m || 0}-${m.freq?.a || 0}-${m.freq?.n || 0}`;
      doc.text(name, 50, y, { width: 200 });
      doc.text(freq, 250, y, { width: 60 });
      doc.text(String(m.duration || 0), 310, y, { width: 40 });
      doc.text(String(m.qty || 0), 350, y, { width: 40 });
      doc.text(`₹${m.price || 0}`, 390, y, { width: 60 });
      doc.text(`₹${m.subtotal || 0}`, 460, y, { width: 80, align: "right" });
      doc.moveDown(0.5);
    });

    if (meds.length === 0) {
      doc.text("As per prescription — to be verified by pharmacist", 50);
      doc.moveDown(0.5);
    }

    // Totals
    doc.moveDown(0.5);
    doc.moveTo(350, doc.y).lineTo(545, doc.y).strokeColor("#E2E8F0").stroke();
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica");
    const totY1 = doc.y;
    doc.text("Subtotal:", 350, totY1); doc.text(`₹${rx?.subtotal || order.totalAmount || 0}`, 460, totY1, { width: 80, align: "right" });
    doc.moveDown(0.3);
    const totY2 = doc.y;
    doc.text("GST (12%):", 350, totY2); doc.text(`₹${rx?.gst || 0}`, 460, totY2, { width: 80, align: "right" });
    doc.moveDown(0.3);
    doc.moveTo(350, doc.y).lineTo(545, doc.y).strokeColor("#7F0E25").lineWidth(1).stroke();
    doc.moveDown(0.3);
    const totY3 = doc.y;
    doc.fontSize(12).font("Helvetica-Bold").fillColor("#7F0E25");
    doc.text("Total:", 350, totY3); doc.text(`₹${order.totalAmount || 0}`, 460, totY3, { width: 80, align: "right" });

    // Footer
    doc.moveDown(3);
    doc.fontSize(9).font("Helvetica").fillColor("#999").text("Thank you for choosing RG Medlink!", { align: "center" });
    doc.text("This is a computer-generated invoice.", { align: "center" });

    doc.end();
  } catch (error) {
    res.status(500).json({ success: false, message: "Invoice generation failed", error: error.message });
  }
});

// CANCEL ORDER
router.patch("/:id/cancel", async (req, res) => {
  try {
    const Order = require("../models/Order");
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (["Shipped", "Delivered"].includes(order.orderStatus)) {
      return res.status(400).json({ success: false, message: "Cannot cancel shipped/delivered orders" });
    }
    order.orderStatus = "Cancelled";
    await order.save();
    res.json({ success: true, message: "Order cancelled successfully", order });
  } catch (error) {
    res.status(500).json({ success: false, message: "Cancel failed", error: error.message });
  }
});

module.exports = router;