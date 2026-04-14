const pdfParseLib = require("pdf-parse");
const fs = require("fs");

// 🔥 IMPORT YOUR OCR FUNCTION
const { extractTextFromImage } = require("./imageOCR");

const pdfParse = pdfParseLib.default || pdfParseLib;

const extractTextFromPDF = async (filePath) => {
  try {
    const dataBuffer = fs.readFileSync(filePath);

    const pdfData = await pdfParse(dataBuffer);

    const text = pdfData.text?.trim();

    // ✅ If PDF has readable text
    if (text && text.length > 20) {
      console.log("✅ PDF parsed successfully");
      return text.toLowerCase();
    }

    throw new Error("Empty PDF text");

  } catch (err) {
    console.log("❌ PDF parse failed → using OCR");
    console.log("Error:", err.message);

    // 🔥 FALLBACK TO OCR
    const ocrText = await extractTextFromImage(filePath);

    return ocrText.toLowerCase();
  }
};

module.exports = extractTextFromPDF;