  const express = require("express");
  const router = express.Router();

  const {
    getTickets,
    getTicketById,
    createTicket,
    updateTicketStatus,
    updateTicketPriority,
    assignTicket,
    addReply,
    deleteTicket,
    getTicketStats,
  } = require("../controllers/ticketController");

  // GET TICKET STATS (must be before /:id)
  router.get("/stats", getTicketStats);

  // GET ALL TICKETS
  router.get("/", getTickets);

  // GET SINGLE TICKET
  router.get("/:id", getTicketById);

  // CREATE TICKET
  router.post("/", createTicket);

  // UPDATE STATUS
  router.patch("/:id/status", updateTicketStatus);

  // UPDATE PRIORITY
  router.patch("/:id/priority", updateTicketPriority);

  // ASSIGN TICKET
  router.patch("/:id/assign", assignTicket);

  // ADD REPLY
  router.post("/:id/reply", addReply);

  // DELETE TICKET
  router.delete("/:id", deleteTicket);

  module.exports = router;
