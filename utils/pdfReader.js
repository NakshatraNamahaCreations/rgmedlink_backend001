const pdfParseLib = require("pdf-parse");
const fs = require("fs");

// ✅ handle both cases (function OR default export)
const pdfParse = pdfParseLib.default || pdfParseLib;

const extractTextFromPDF = async (filePath) => {
  const dataBuffer = fs.readFileSync(filePath);
  const pdfData = await pdfParse(dataBuffer);
  return pdfData.text.toLowerCase();
};

module.exports = extractTextFromPDF;