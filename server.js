    require("dotenv").config();

    const express = require("express");
    const cors = require("cors");
    const connectDB = require("./config/db");

    const addressRoutes = require("./routes/addressRoutes");
    const reportRoutes = require("./routes/reportRoutes");
    const otpRoutes = require("./routes/otpRoutes");
    const patientDetailsRoutes = require("./routes/patientDetailsRoutes");

    const medicineRoutes = require("./routes/medicineRoutes");
    const patientRoutes = require("./routes/patientRoutes");
    const prescriptionRoutes = require("./routes/prescriptionRoutes");
    const dashboardRoutes = require("./routes/dashboardRoutes");
    const orderRoutes = require("./routes/orderRoutes");
    const authRoutes = require("./routes/authRoutes");

    const uploadRoutes = require("./routes/uploadRoutes");
    const ticketRoutes = require("./routes/ticketRoutes");


    const helmet = require("helmet");
    const rateLimit = require("express-rate-limit");
    // const mongoSanitize = require("express-mongo-sanitize"); // Incompatible with Express 5
    const { authMiddleware } = require("./middleware/auth");

    connectDB();

    const app = express();

    // Security headers
    app.use(helmet());

    // Rate limiting — 100 requests per minute per IP
    app.use(rateLimit({ windowMs: 60 * 1000, max: 100, validate: false }));

    // CORS
    app.use(
      cors({
        origin: [
          "http://localhost:3000",
          "http://localhost:5173",
          "http://localhost:8081",
          "https://rgmedlinkadminpanel.netlify.app",
          "https://rgmedlinkadmipanel.netlify.app",
          /\.rgmedlink\.com$/,
        ],
        credentials: true,
      })
    );

    // Body parsing with size limit
    app.use(express.json({ limit: "10mb" }));
    app.use(express.urlencoded({ extended: true, limit: "10mb" }));

    // Note: express-mongo-sanitize removed — incompatible with Express 5 read-only req.query

    // Auth middleware
    app.use(authMiddleware);

    // Health check
    app.get("/health", (req, res) => res.json({ status: "ok", uptime: process.uptime() }));

    /* ROUTES */
    app.use("/api/medicines", medicineRoutes);
    app.use("/api/patients", patientRoutes);
    app.use("/api/prescriptions", prescriptionRoutes);
    app.use("/api/dashboard", dashboardRoutes);
    app.use("/api/orders", orderRoutes);
    app.use("/api/reports", reportRoutes);
    app.use("/api/address", addressRoutes);
    app.use("/api/patient-details", patientDetailsRoutes);
    app.use("/api/otp", otpRoutes);
    app.use("/api/auth", authRoutes);
    app.use("/api/upload", uploadRoutes);
    app.use("/api/tickets", ticketRoutes);

    app.get("/", (req, res) => {
      res.send("RG Medlink API Running");
    });

    const PORT = process.env.PORT || 5000;

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });