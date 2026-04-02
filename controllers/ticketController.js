const Ticket = require("../models/Ticket");

/* ── pagination helper ───────────────────────────────────────── */
function paginate(query) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const raw = parseInt(query.limit);
  const all = raw === 0;
  const limit = all ? 0 : Math.min(Math.max(raw || 10, 1), 100);
  const skip = all ? 0 : (page - 1) * limit;
  return { page, limit, skip, all };
}


// ============================
// GET ALL TICKETS (server-side paginated)
// ============================
exports.getTickets = async (req, res) => {
  try {
    const { page, limit, skip, all } = paginate(req.query);
    const { status, priority, category, search, from, to } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (category) filter.category = category;

    if (search) {
      filter.$or = [
        { ticketId: { $regex: search, $options: "i" } },
        { subject: { $regex: search, $options: "i" } },
        { customerName: { $regex: search, $options: "i" } },
      ];
    }

    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }

    let q = Ticket.find(filter).sort({ createdAt: -1 }).lean();
    if (!all) q = q.skip(skip).limit(limit);

    const [tickets, total] = await Promise.all([q, Ticket.countDocuments(filter)]);

    res.json({
      success: true,
      data: tickets,
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
// GET SINGLE TICKET
// ============================
exports.getTicketById = async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found" });

    res.json({ success: true, data: ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ============================
// CREATE TICKET
// ============================
exports.createTicket = async (req, res) => {
  try {
    const { userId, customerName, customerPhone, customerEmail, subject, category, priority, description, orderId } = req.body;

    if (!customerName || !subject || !description) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const ticket = await Ticket.create({
      ticketId: "TKT-" + Date.now(),
      userId, customerName, customerPhone, customerEmail,
      subject, category, priority, description, orderId,
    });

    res.status(201).json({ success: true, message: "Ticket created successfully", data: ticket });
  } catch (err) {
    res.status(500).json({ success: false, message: "Ticket creation failed", error: err.message });
  }
};


// ============================
// UPDATE TICKET STATUS
// ============================
exports.updateTicketStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ["Open", "In Progress", "Resolved", "Closed"];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const updateData = { status };
    if (status === "Resolved") updateData.resolvedAt = new Date();

    const ticket = await Ticket.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found" });

    res.json({ success: true, message: "Ticket status updated", data: ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ============================
// UPDATE TICKET PRIORITY
// ============================
exports.updateTicketPriority = async (req, res) => {
  try {
    const { priority } = req.body;
    const validPriorities = ["Low", "Medium", "High", "Urgent"];

    if (!validPriorities.includes(priority)) {
      return res.status(400).json({ success: false, message: "Invalid priority" });
    }

    const ticket = await Ticket.findByIdAndUpdate(req.params.id, { priority }, { new: true });
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found" });

    res.json({ success: true, message: "Ticket priority updated", data: ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ============================
// ASSIGN TICKET
// ============================
exports.assignTicket = async (req, res) => {
  try {
    const { assignedTo } = req.body;
    if (!assignedTo) return res.status(400).json({ success: false, message: "assignedTo is required" });

    const ticket = await Ticket.findByIdAndUpdate(req.params.id, { assignedTo }, { new: true });
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found" });

    res.json({ success: true, message: "Ticket assigned successfully", data: ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ============================
// ADD REPLY
// ============================
exports.addReply = async (req, res) => {
  try {
    const { sender, message } = req.body;
    if (!sender || !message) {
      return res.status(400).json({ success: false, message: "sender and message are required" });
    }

    const validSenders = ["Customer", "Admin"];
    if (!validSenders.includes(sender)) {
      return res.status(400).json({ success: false, message: "Invalid sender" });
    }

    const ticket = await Ticket.findByIdAndUpdate(
      req.params.id,
      { $push: { messages: { sender, message, timestamp: new Date() } } },
      { new: true }
    );

    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found" });

    res.json({ success: true, message: "Reply added successfully", data: ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ============================
// DELETE TICKET
// ============================
exports.deleteTicket = async (req, res) => {
  try {
    const ticket = await Ticket.findByIdAndDelete(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found" });

    res.json({ success: true, message: "Ticket deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ============================
// GET TICKET STATS (optimized single aggregation)
// ============================
exports.getTicketStats = async (req, res) => {
  try {
    const [statusCounts, priorityCounts] = await Promise.all([
      Ticket.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Ticket.aggregate([{ $group: { _id: "$priority", count: { $sum: 1 } } }]),
    ]);

    const byStatus = {};
    statusCounts.forEach((s) => { byStatus[s._id] = s.count; });

    const byPriority = {};
    priorityCounts.forEach((p) => { byPriority[p._id] = p.count; });

    res.json({
      success: true,
      data: {
        byStatus,
        byPriority,
        total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
