const Prescription = require("../models/Prescription");
const Medicine = require("../models/Medicine");
const fs = require("fs");

const extractTextFromPDF = require("../utils/pdfReader");
const generateStyledPDF = require("../utils/generateStyledPDF");
const { extractTextFromImage, parsePrescriptionText } = require("../utils/imageOCR");

// ============================
// IMAGE PRESCRIPTION UPLOAD (camera/gallery)
// ============================
exports.processImagePrescription = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const filePath = req.file.path;
    const dbMedicines = await Medicine.find({ status: "Active" });
    const matchedMeds = [];

    // Helper: match parsed medicine name to DB for pricing
    const findDBMatch = (medName) => {
      const search = medName.toLowerCase().replace(/\s+/g, "");
      if (search.length < 3) return null;
      return dbMedicines.find((dbMed) => {
        const dbBase = dbMed.name.toLowerCase().replace(/\s*\d+\s*mg|\s*\d+\s*ml/g, "").replace(/\s+/g, "");
        return dbBase.includes(search) || search.includes(dbBase);
      });
    };

    // ── STEP 1: OCR (OCR.space API → Tesseract fallback) ──
    let extractedText = "";
    try {
      extractedText = await extractTextFromImage(filePath);
    } catch (ocrErr) {
      console.log("OCR failed:", ocrErr.message);
    }

    // ── STEP 2: Parse structured medicines from text ──
    const parsed = parsePrescriptionText(extractedText);
    const addedNames = new Set();

    for (const parsedMed of parsed.medicines) {
      const dbMatch = findDBMatch(parsedMed.name);
      const price = dbMatch ? (dbMatch.sellingPrice || dbMatch.price || 0) : 0;
      const name = dbMatch?.name || parsedMed.name;

      addedNames.add(name.toLowerCase());
      const stock = dbMatch?.stock ?? 0;
      matchedMeds.push({
        medicineId: dbMatch?._id || null,
        name,
        category: dbMatch?.category || "Tablet",
        unit: dbMatch?.unit || "Tablet",
        dosage: parsedMed.dosage,
        freq: parsedMed.freq,
        freqLabel: parsedMed.freqLabel,
        duration: parsedMed.duration,
        qty: parsedMed.qty,
        price,
        subtotal: parsedMed.qty * price,
        stock,
        inStock: stock >= parsedMed.qty,
      });
    }

    // ── STEP 3: ALWAYS scan OCR text against DB medicines ──
    // This catches medicines the parser missed (table formats, no prefix, etc.)
    if (extractedText) {
      // Extract all durations mentioned in the text for context
      const allDurations = [];
      const durRegex = /(\d+)\s*(?:days?|d\b)/gi;
      let dm;
      while ((dm = durRegex.exec(extractedText)) !== null) {
        allDurations.push(parseInt(dm[1], 10));
      }

      // Frequency patterns in the full text
      const freqInText = /1\s*[-–—.,]\s*0\s*[-–—.,]\s*1/i.test(extractedText) ? { m: 1, a: 0, n: 1, label: "1-0-1" }
        : /1\s*[-–—.,]\s*1\s*[-–—.,]\s*1/i.test(extractedText) ? { m: 1, a: 1, n: 1, label: "1-1-1" }
        : /\bbd\b|\btwice/i.test(extractedText) ? { m: 1, a: 0, n: 1, label: "1-0-1" }
        : /\btds\b|\bthrice/i.test(extractedText) ? { m: 1, a: 1, n: 1, label: "1-1-1" }
        : { m: 1, a: 0, n: 1, label: "1-0-1" };

      for (const med of dbMedicines) {
        if (addedNames.has(med.name.toLowerCase())) continue;

        const baseName = med.name.toLowerCase().replace(/\s*\d+\s*mg|\s*\d+\s*ml/g, "").trim();
        if (baseName.length < 3) continue;

        // Check if medicine name appears in OCR text
        if (extractedText.includes(baseName)) {
          // Try to find a duration near this medicine in the text
          const medIdx = extractedText.indexOf(baseName);
          const nearbyText = extractedText.substring(Math.max(0, medIdx - 50), medIdx + baseName.length + 80);
          const nearDur = nearbyText.match(/(\d+)\s*(?:days?|d\b)/i);
          const duration = nearDur ? parseInt(nearDur[1], 10) : (allDurations.length > 0 ? allDurations[0] : 5);

          // Try to find frequency near this medicine
          let freq = { ...freqInText };
          let freqLabel = freqInText.label;
          const nearFreq = nearbyText.match(/(\d)\s*[-–—.,]\s*(\d)\s*[-–—.,]\s*(\d)/);
          if (nearFreq) {
            freq = { m: parseInt(nearFreq[1]), a: parseInt(nearFreq[2]), n: parseInt(nearFreq[3]) };
            freqLabel = `${freq.m}-${freq.a}-${freq.n}`;
          }

          const daily = freq.m + freq.a + freq.n;
          const qty = daily * duration;
          const price = med.sellingPrice || med.price || 0;

          addedNames.add(med.name.toLowerCase());
          matchedMeds.push({
            medicineId: med._id,
            name: med.name,
            category: med.category,
            unit: med.unit,
            dosage: "",
            freq,
            freqLabel,
            duration,
            qty,
            price,
            subtotal: qty * price,
            stock: med.stock || 0,
            inStock: (med.stock || 0) >= qty,
          });
        }
      }
    }

    // Only keep medicines that matched a DB entry (have a price) or look like real medicine names
    const validMeds = matchedMeds.filter(m => m.medicineId || m.price > 0);
    console.log(`Final matched: ${matchedMeds.length} raw → ${validMeds.length} valid`, validMeds.map(m => `${m.name} ${m.freqLabel} ${m.duration}d qty:${m.qty} ₹${m.subtotal}`));

    const subtotal = validMeds.reduce((sum, m) => sum + m.subtotal, 0);
    const gst = subtotal * 0.12;
    const total = subtotal + gst;

    // Clean up uploaded file
    try { fs.unlinkSync(filePath); } catch {}

    res.json({
      success: true,
      message: validMeds.length > 0
        ? `Found ${validMeds.length} medicine(s) in prescription`
        : "Prescription uploaded. Our pharmacist will verify and add medicines.",
      prescription: {
        rxId: `RX-${Date.now()}`,
        doctor: parsed.doctor || "To be verified",
        date: new Date().toISOString(),
        medsCount: validMeds.length,
        medicines: validMeds,
        subtotal,
        gst,
        total,
      },
    });
  } catch (error) {
    console.error("IMAGE UPLOAD ERROR:", error);
    res.status(500).json({ message: "Error processing image", error: error.message });
  }
};

// ============================
// PDF PRESCRIPTION UPLOAD
// ============================
exports.processPDFPrescription = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const filePath = req.file.path;

    // Extract text from PDF
    const text = await extractTextFromPDF(filePath);
    console.log("PDF EXTRACTED TEXT:", text);

    // Parse medicines
    const parsed = parsePrescriptionText(text);
    const dbMedicines = await Medicine.find({ status: "Active" });
    const matchedMeds = [];
    const addedNames = new Set();

    const findDBMatch = (medName) => {
      const search = medName.toLowerCase().replace(/\s+/g, "");
      if (search.length < 3) return null;
      return dbMedicines.find((dbMed) => {
        const dbBase = dbMed.name.toLowerCase().replace(/\s*\d+\s*mg|\s*\d+\s*ml/g, "").replace(/\s+/g, "");
        return dbBase.includes(search) || search.includes(dbBase);
      });
    };

    // From parser
    for (const parsedMed of parsed.medicines) {
      const dbMatch = findDBMatch(parsedMed.name);
      const price = dbMatch ? (dbMatch.sellingPrice || dbMatch.price || 0) : 0;
      const name = dbMatch?.name || parsedMed.name;
      addedNames.add(name.toLowerCase());
      matchedMeds.push({
        medicineId: dbMatch?._id || null,
        name,
        category: dbMatch?.category || "Tablet",
        unit: dbMatch?.unit || "Tablet",
        dosage: parsedMed.dosage,
        freq: parsedMed.freq,
        freqLabel: parsedMed.freqLabel,
        duration: parsedMed.duration,
        qty: parsedMed.qty,
        price,
        subtotal: parsedMed.qty * price,
        stock: dbMatch?.stock || 0,
        inStock: (dbMatch?.stock || 0) >= parsedMed.qty,
      });
    }

    // Fallback: text match against DB
    if (matchedMeds.length === 0 && text) {
      for (const med of dbMedicines) {
        const baseName = med.name.toLowerCase().replace(/\s*\d+\s*mg|\s*\d+\s*ml/g, "").trim();
        if (baseName.length >= 4 && text.includes(baseName) && !addedNames.has(med.name.toLowerCase())) {
          const freq = { m: 1, a: 0, n: 1 };
          const duration = 5;
          const daily = 2;
          const qty = daily * duration;
          const price = med.sellingPrice || med.price || 0;
          addedNames.add(med.name.toLowerCase());
          matchedMeds.push({
            medicineId: med._id, name: med.name, category: med.category, unit: med.unit,
            dosage: "", freq, freqLabel: "1-0-1", duration, qty, price, subtotal: qty * price,
            stock: med.stock || 0, inStock: (med.stock || 0) >= qty,
          });
        }
      }
    }

    console.log(`PDF matched ${matchedMeds.length} medicines`);

    const subtotal = matchedMeds.reduce((sum, m) => sum + m.subtotal, 0);
    const gst = subtotal * 0.12;
    const total = subtotal + gst;

    // Clean up
    try { fs.unlinkSync(filePath); } catch {}

    res.json({
      success: true,
      message: matchedMeds.length > 0
        ? `Found ${matchedMeds.length} medicine(s) in PDF`
        : "PDF uploaded. Our pharmacist will verify.",
      prescription: {
        rxId: `RX-${Date.now()}`,
        doctor: parsed.doctor || "To be verified",
        date: new Date().toISOString(),
        medsCount: matchedMeds.length,
        medicines: matchedMeds,
        subtotal,
        gst,
        total,
      },
    });
  } catch (error) {
    console.error("PDF UPLOAD ERROR:", error);
    res.status(500).json({ message: "Error processing PDF", error: error.message });
  }
};
