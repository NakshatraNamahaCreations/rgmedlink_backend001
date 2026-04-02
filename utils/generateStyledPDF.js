const PDFDocument = require("pdfkit");
const fs = require("fs");

const generateStyledPDF = (medicines, filePath) => {
  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(fs.createWriteStream(filePath));

  // HEADER
  doc
    .fillColor("#0B5ED7")
    .fontSize(20)
    .text("RG Medlink Prescription", { align: "center" });

  doc.moveDown();

  // TABLE HEADER
  doc
    .fillColor("#0B5ED7")
    .rect(40, doc.y, 520, 25)
    .fill();

  doc
    .fillColor("white")
    .fontSize(11)
    .text("Medicine", 50, doc.y - 18)
    .text("Price", 250, doc.y - 18)
    .text("Available", 350, doc.y - 18);

  let y = doc.y + 10;

  // DATA
  medicines.forEach((med) => {
    doc
      .fillColor("black")
      .text(med.name, 50, y)
      .text(`₹${med.price}`, 250, y)
      .text(med.available ? "Yes" : "No", 350, y);

    y += 25;
  });

  doc.end();
};

module.exports = generateStyledPDF;