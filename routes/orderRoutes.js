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
   createRazorpayOrder,
  verifyRazorpayPayment,
  updatePaymentStatus
} = require("../controllers/orderController");

// ADMIN: CREATE ORDER DIRECTLY (patient + medicines + address in one shot)
router.post("/admin-create", createAdminOrder);


router.post("/create-razorpay-order", createRazorpayOrder);
router.post("/verify-payment", verifyRazorpayPayment);

router.patch("/update-payment/:id", updatePaymentStatus);
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

    const order = await Order.findById(req.params.id);
    if (!order)
      return res.status(404).json({ success: false, message: "Order not found" });

    const meds = order.items || [];

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=invoice-${order.orderId}.pdf`
    );
    doc.pipe(res);

    // Header
    doc.fontSize(24).font("Helvetica-Bold").fillColor("#7F0E25")
      .text("RG Medlink", { align: "center" });

    doc.fontSize(10).font("Helvetica").fillColor("#666")
      .text("Your Health, Delivered", { align: "center" });

    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#E2E8F0").stroke();
    doc.moveDown(1);

    // Invoice details
    doc.fontSize(16).font("Helvetica-Bold").fillColor("#000").text("TAX INVOICE");
    doc.moveDown(0.5);

    doc.fontSize(10).font("Helvetica").fillColor("#333");
    doc.text(`Invoice No: ${order.invoiceNumber || order.orderId}`);
    doc.text(`Order ID: ${order.orderId}`);
    doc.text(
      `Date: ${new Date(order.createdAt).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })}`
    );
    doc.text(`Payment: ${order.paymentStatus || "Pending"}`);
    doc.moveDown(1);

    // Patient details
    doc.fontSize(12).font("Helvetica-Bold").text("Bill To:");
    doc.fontSize(10).font("Helvetica").fillColor("#333");
    doc.text(order.patientDetails?.name || "Patient");
    doc.text(`Phone: ${order.patientDetails?.phone || "—"}`);
    doc.text(`Address: ${order.deliveryAddress || "—"}`);
    doc.moveDown(1);

    // Table header
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#7F0E25").lineWidth(1).stroke();
    doc.moveDown(0.3);

    const tableTop = doc.y;

    doc.fontSize(9).font("Helvetica-Bold").fillColor("#7F0E25");
    doc.text("Medicine", 50, tableTop, { width: 200 });
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

      const name = m.name;
      const qty = m.qty || 0;
      const price = m.price || 0;
      const subtotal = qty * price;

      doc.text(name, 50, y, { width: 200 });
      doc.text(String(qty), 350, y);
      doc.text(`₹${price}`, 390, y);
      doc.text(`₹${subtotal}`, 460, y, { align: "right" });

      doc.moveDown(0.5);
    });

    if (meds.length === 0) {
      doc.text("No medicines found", 50);
      doc.moveDown(0.5);
    }

    // ✅ TOTALS (FIXED)
    doc.moveDown(0.5);
    doc.moveTo(350, doc.y).lineTo(545, doc.y).strokeColor("#E2E8F0").stroke();
    doc.moveDown(0.3);

    doc.fontSize(10).font("Helvetica");

    const subtotal = meds.reduce(
      (sum, m) => sum + ((m.qty || 0) * (m.price || 0)),
      0
    );

    const gst = subtotal * 0.12;

    // Subtotal
    const totY1 = doc.y;
    doc.text("Subtotal:", 350, totY1);
    doc.text(`₹${subtotal.toFixed(2)}`, 460, totY1, {
      width: 80,
      align: "right",
    });

    doc.moveDown(0.3);

    // GST
    const totY2 = doc.y;
    doc.text("GST (12%):", 350, totY2);
    doc.text(`₹${gst.toFixed(2)}`, 460, totY2, {
      width: 80,
      align: "right",
    });

    doc.moveDown(0.3);

    // Divider
    doc.moveTo(350, doc.y)
      .lineTo(545, doc.y)
      .strokeColor("#7F0E25")
      .lineWidth(1)
      .stroke();

    doc.moveDown(0.3);

    // Total
    const totY3 = doc.y;
    doc.fontSize(12).font("Helvetica-Bold").fillColor("#7F0E25");

    doc.text("Total:", 350, totY3);
    doc.text(`₹${order.totalAmount.toFixed(2)}`, 460, totY3, {
      width: 80,
      align: "right",
    });

    // Footer
    doc.moveDown(3);
    doc.fontSize(9).font("Helvetica").fillColor("#999")
      .text("Thank you for choosing RG Medlink!", { align: "center" });

    doc.text("This is a computer-generated invoice.", { align: "center" });

    doc.end();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Invoice generation failed",
      error: error.message,
    });
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