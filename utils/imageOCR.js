const fs = require("fs");
const path = require("path");

const OCR_API_KEY = process.env.OCR_API_KEY;
const OCR_API_URL = "https://api.ocr.space/parse/image";

/**
 * Run OCR.space with a specific engine and return extracted text.
 */
async function runOCREngine(base64Data, mimeType, engine) {
  const formBody = new URLSearchParams();
  formBody.append("apikey", OCR_API_KEY);
  formBody.append("base64Image", `data:${mimeType};base64,${base64Data}`);
  formBody.append("language", "eng");
  formBody.append("isOverlayRequired", "false");
  formBody.append("OCREngine", String(engine));
  formBody.append("scale", "true");
  formBody.append("isTable", "true");
  formBody.append("detectOrientation", "true");

  const response = await fetch(OCR_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody.toString(),
  });

  const result = await response.json();

  if (result.ParsedResults && result.ParsedResults.length > 0) {
    return result.ParsedResults[0].ParsedText || "";
  }
  return "";
}

/**
 * Extract text from prescription image.
 * Tries BOTH OCR engines and picks the one with better medicine-related content.
 */
async function extractTextFromImage(filePath) {
  // Ensure proper extension
  let targetPath = filePath;
  const ext = path.extname(filePath).toLowerCase();
  if (!ext || ![".jpg", ".jpeg", ".png", ".bmp", ".webp"].includes(ext)) {
    targetPath = filePath + ".jpg";
    fs.copyFileSync(filePath, targetPath);
  }

  if (!OCR_API_KEY) {
    console.log("No OCR_API_KEY, falling back to Tesseract");
    return fallbackTesseract(targetPath, filePath);
  }

  const imageData = fs.readFileSync(targetPath);
  const base64 = imageData.toString("base64");
  const mimeType = targetPath.endsWith(".png") ? "image/png" : "image/jpeg";

  try {
    // Run BOTH engines in parallel
    console.log("Running OCR Engine 1 & 2 in parallel...");
    const [text1, text2] = await Promise.all([
      runOCREngine(base64, mimeType, 1).catch(() => ""),
      runOCREngine(base64, mimeType, 2).catch(() => ""),
    ]);

    console.log("=== Engine 1 ===", text1.substring(0, 300));
    console.log("=== Engine 2 ===", text2.substring(0, 300));

    // Score each result — prefer the one with more medicine-related keywords
    const score = (text) => {
      if (!text) return 0;
      let s = text.length; // base score: more text = better
      const lower = text.toLowerCase();
      // Bonus for medicine-related content
      const medKeywords = [
        "tab", "cap", "syp", "syr", "inj", "mg", "ml", "mcg",
        "1-0-1", "1-1-1", "0-0-1", "1-0-0",
        "bd", "tds", "od", "hs", "sos",
        "twice", "thrice", "daily", "days", "morning", "night",
        "after food", "before food", "empty stomach",
        "dr.", "rx", "prescription",
        "paracetamol", "amoxicillin", "azithromycin", "metformin",
        "omeprazole", "atorvastatin", "vitamin", "dolo", "crocin",
        "pan", "shelcal", "cipla", "ranbaxy",
      ];
      for (const kw of medKeywords) {
        if (lower.includes(kw)) s += 50;
      }
      // Bonus for frequency patterns
      if (/\d\s*[-–.]\s*\d\s*[-–.]\s*\d/.test(lower)) s += 100;
      // Penalty for too much garbage (many single-char words)
      const words = lower.split(/\s+/);
      const singleChars = words.filter((w) => w.length === 1).length;
      if (singleChars > words.length * 0.4) s -= 200;
      return s;
    };

    const s1 = score(text1);
    const s2 = score(text2);
    const bestText = s1 >= s2 ? text1 : text2;
    const bestEngine = s1 >= s2 ? 1 : 2;

    console.log(`Engine scores: E1=${s1}, E2=${s2}. Using Engine ${bestEngine}`);
    console.log("=== BEST OCR TEXT ===");
    console.log(bestText);
    console.log("=====================");

    if (targetPath !== filePath) try { fs.unlinkSync(targetPath); } catch {}

    return bestText.toLowerCase();
  } catch (err) {
    console.error("OCR.space failed:", err.message);
    return fallbackTesseract(targetPath, filePath);
  }
}

async function fallbackTesseract(targetPath, filePath) {
  try {
    const Tesseract = require("tesseract.js");
    const { data } = await Tesseract.recognize(targetPath, "eng");
    if (targetPath !== filePath) try { fs.unlinkSync(targetPath); } catch {}
    return (data.text || "").toLowerCase();
  } catch {
    if (targetPath !== filePath) try { fs.unlinkSync(targetPath); } catch {}
    return "";
  }
}

/**
 * Parse prescription text to extract medicine details.
 * Uses TWO strategies:
 *   1. Full-text scan for known medicine names (handles table/column layouts)
 *   2. Line-by-line parsing for structured prescriptions
 */
function parsePrescriptionText(text) {
  if (!text || text.length < 10) return { medicines: [], doctor: null };

  // Normalize text
  const rawText = text.replace(/\r\n/g, "\n");

  const medicines = [];
  const seen = new Set();

  // ══════════════════════════════════════════════
  // PRE-STEP: Detect TABLE format (tab-separated columns)
  // OCR often reads tables as:
  //   Row 1: NAME1 \t NAME2 \t NAME3
  //   Row 2: FREQ1 \t FREQ2 \t FREQ3
  //   Row 3: DUR1  \t DUR2  \t DUR3
  // ══════════════════════════════════════════════
  const rawLines = rawText.split("\n").map((l) => l.trim()).filter((l) => l.length > 1);

  // Check if any line has multiple tab-separated values
  const tabLines = rawLines.filter((l) => l.includes("\t") && l.split("\t").filter(Boolean).length >= 2);

  if (tabLines.length >= 2) {
    console.log("Detected TABLE format, parsing columns...");

    // Split each line by tabs
    const rows = tabLines.map((l) => l.split("\t").map((c) => c.trim()).filter(Boolean));

    // Find the row with most medicine-like content (names)
    // and rows with frequencies / durations
    let nameRow = null, freqRow = null, durRow = null;

    for (const row of rows) {
      const hasFreqPattern = row.some((c) => /\d\s*[-–—.,]\s*\d\s*[-–—.,]\s*\d/.test(c));
      const hasDuration = row.some((c) => /\d+\s*days?/i.test(c));
      const hasMedName = row.some((c) => /^[a-zA-Z\s]{3,}/.test(c) && !/days?/i.test(c) && !/\d\s*[-–]\s*\d/.test(c));

      if (hasMedName && !nameRow) nameRow = row;
      else if (hasFreqPattern && !freqRow) freqRow = row;
      else if (hasDuration && !durRow) durRow = row;
    }

    if (nameRow && nameRow.length >= 2) {
      console.log("Name row:", nameRow);
      console.log("Freq row:", freqRow);
      console.log("Dur row:", durRow);

      for (let i = 0; i < nameRow.length; i++) {
        let name = nameRow[i].trim();
        if (!name || name.length < 2) continue;

        // Get corresponding frequency
        let freq = { m: 1, a: 0, n: 1 };
        let freqLabel = "1-0-1";
        if (freqRow && freqRow[i]) {
          const fc = freqRow[i];
          const fm = fc.match(/(\d)\s*[-–—.,]\s*(\d)\s*[-–—.,]\s*(\d)/);
          if (fm) {
            freq = { m: parseInt(fm[1]), a: parseInt(fm[2]), n: parseInt(fm[3]) };
            freqLabel = `${freq.m}-${freq.a}-${freq.n}`;
          }
        }

        // Get corresponding duration
        let duration = 5;
        if (durRow && durRow[i]) {
          const dm = durRow[i].match(/(\d+)\s*days?/i);
          if (dm) duration = parseInt(dm[1], 10);
        }

        // Extract dosage from name
        const dosageMatch = name.match(/(\d+\.?\d*\s*(?:mg|ml|mcg|gm?|iu))/i);
        const dosage = dosageMatch ? dosageMatch[1].trim() : "";

        // Clean name
        name = name.replace(/(\d+\.?\d*\s*(?:mg|ml|mcg|gm?|iu))/gi, "").trim();
        name = name.replace(/^(tab|cap|syp|syr|inj)\.?\s*/i, "").trim();
        name = name.replace(/[^a-zA-Z0-9\s\-]/g, " ").replace(/\s+/g, " ").trim();

        if (!name || name.length < 3) continue;

        // Fix OCR misreads
        const nameJoined = name.toLowerCase().replace(/\s+/g, "");
        const ocrFixMap = {
          "paraeetamol": "Paracetamol", "paracetamol": "Paracetamol", "paraeet amol": "Paracetamol",
          "dodo": "Dolo", "dodo 650": "Dolo 650",
          "tylenal": "Tylenol", "tylanal": "Tylenol",
          "tramadal": "Tramadol", "tradamol": "Tramadol",
          "amoxicilin": "Amoxicillin",
          "azithromicin": "Azithromycin",
        };

        let fixedName = null;
        for (const [wrong, right] of Object.entries(ocrFixMap)) {
          if (nameJoined === wrong.replace(/\s+/g, "") || name.toLowerCase() === wrong) {
            fixedName = right;
            break;
          }
        }
        if (fixedName) name = fixedName;
        else {
          // Capitalize normally
          name = name.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
        }

        // Calculate qty
        const daily = freq.m + freq.a + freq.n;
        const qty = daily * duration;

        const key = name.toLowerCase().replace(/[\s\d]/g, "");
        if (!seen.has(key)) {
          seen.add(key);
          medicines.push({ name, dosage, freq, duration, qty, freqLabel });
        }
      }
    }
  }

  // If table parsing found medicines, return them (skip line-by-line)
  if (medicines.length >= 2) {
    // Extract doctor
    let doctor = null;
    const drMatch = rawText.match(/dr\.?\s+([a-z][a-z\s.]{2,30})/i);
    if (drMatch) doctor = "Dr. " + drMatch[1].trim().split("\n")[0].replace(/\s+/g, " ");

    console.log(`Table parser found ${medicines.length} medicines:`);
    medicines.forEach((m) => console.log(`  ${m.name} ${m.dosage} | ${m.freqLabel} | ${m.duration}d | qty:${m.qty}`));

    return { medicines, doctor };
  }

  // ══════════════════════════════════════════════
  // FALLBACK: Line-by-line parsing
  // ══════════════════════════════════════════════
  text = rawText.replace(/\t+/g, "  ");
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 2);

  // ── Frequency patterns ──
  const freqPatterns = [
    { regex: /1\s*[-–—x.,]\s*1\s*[-–—x.,]\s*1/i, m: 1, a: 1, n: 1, label: "1-1-1" },
    { regex: /1\s*[-–—x.,]\s*0\s*[-–—x.,]\s*1/i, m: 1, a: 0, n: 1, label: "1-0-1" },
    { regex: /0\s*[-–—x.,]\s*0\s*[-–—x.,]\s*1/i, m: 0, a: 0, n: 1, label: "0-0-1" },
    { regex: /1\s*[-–—x.,]\s*0\s*[-–—x.,]\s*0/i, m: 1, a: 0, n: 0, label: "1-0-0" },
    { regex: /0\s*[-–—x.,]\s*1\s*[-–—x.,]\s*0/i, m: 0, a: 1, n: 0, label: "0-1-0" },
    { regex: /1\s*[-–—x.,]\s*1\s*[-–—x.,]\s*0/i, m: 1, a: 1, n: 0, label: "1-1-0" },
    { regex: /0\s*[-–—x.,]\s*1\s*[-–—x.,]\s*1/i, m: 0, a: 1, n: 1, label: "0-1-1" },
    { regex: /\bthrice\s*(daily|a\s*day)|\btds\b|\btid\b/i, m: 1, a: 1, n: 1, label: "1-1-1" },
    { regex: /\btwice\s*(daily|a\s*day)|\bbd\b|\bbid\b/i, m: 1, a: 0, n: 1, label: "1-0-1" },
    { regex: /\bonce\s*(daily|a\s*day)|\bod\b|\bqd\b/i, m: 1, a: 0, n: 0, label: "1-0-0" },
    { regex: /\bhs\b|\bat\s*night\b|\bbedtime\b/i, m: 0, a: 0, n: 1, label: "0-0-1" },
    { regex: /\bmorning\s*(?:&|and|,)\s*(?:night|evening)\b/i, m: 1, a: 0, n: 1, label: "1-0-1" },
    { regex: /\bafter\s*(?:food|meals?)\b/i, m: 1, a: 0, n: 1, label: "1-0-1" },
    { regex: /\bbefore\s*(?:food|meals?)\b/i, m: 1, a: 0, n: 1, label: "1-0-1" },
  ];

  // ── Duration patterns ──
  const durationPatterns = [
    { regex: /(\d+)\s*(?:days?|d\b)/i, multiplier: 1 },
    { regex: /(?:for|x|×|into)\s*(\d+)\s*(?:days?|d\b)?/i, multiplier: 1 },
    { regex: /(\d+)\s*(?:weeks?|wks?)/i, multiplier: 7 },
    { regex: /(\d+)\s*(?:months?|mon)/i, multiplier: 30 },
  ];

  // ── Medicine detection patterns ──
  const medPrefixRegex = /\b(tab|cap|syp|syr|inj|oint|cream|drops?|susp|gel|sr|xr|forte|plus)\b\.?\s*/gi;
  const dosageRegex = /(\d+\.?\d*\s*(?:mg|ml|mcg|gm?|iu|%|units?))/i;
  const lineNumRegex = /^\s*(?:\d+[.):\-]\s*|[-•*]\s*|[ivx]+[.)]\s*|rx?\s*\d*[:.)\s]*)/i;

  // Skip patterns
  const skipRegex = /\b(doctor|dr\.|clinic|hospital|phone|tel|mobile|email|address|reg\s*no|date|patient\s*name|age\/sex|sex|gender|weight|height|bp|pulse|diagnosis|chief\s*complaint|signature|stamp|pharmacist|dispense|valid|follow\s*up|review|next\s*visit|advice)\b/i;

  // Known medicine names (common Indian medicines) — helps detect even without prefix
  const knownMeds = [
    "paracetamol", "dolo", "crocin", "calpol",
    "amoxicillin", "augmentin", "mox",
    "azithromycin", "azee", "zithromax",
    "metformin", "glycomet", "glucophage",
    "amlodipine", "amlong", "stamlo",
    "atorvastatin", "atorva", "lipitor",
    "omeprazole", "omez", "prilosec",
    "pantoprazole", "pan", "pantop",
    "cetirizine", "cetrizine", "cetzine", "zyrtec",
    "montelukast", "montair", "singulair",
    "vitamin", "shelcal", "calcirol",
    "ranitidine", "rantac", "aciloc",
    "domperidone", "domstal",
    "ondansetron", "emeset", "vomikind",
    "ibuprofen", "brufen", "motrin",
    "diclofenac", "voveran",
    "tramadol", "ultracet",
    "ciprofloxacin", "cipro", "ciplox",
    "levofloxacin", "levoflox",
    "metronidazole", "flagyl",
    "prednisolone", "wysolone",
    "dexamethasone",
    "insulin",
    "aspirin", "ecosprin",
    "clopidogrel", "clopilet",
    "losartan", "losacar",
    "telmisartan", "telma",
    "hydrochlorothiazide",
    "furosemide", "lasix",
    "salbutamol", "asthalin",
    "budesonide", "budecort",
    "levothyroxine", "thyronorm", "eltroxin",
    "gabapentin",
    "pregabalin",
    "sertraline",
    "fluoxetine",
    "rabeprazole", "razo",
    "esomeprazole", "nexpro",
    "aceclofenac",
    "nimesulide",
    "ofloxacin",
    "norfloxacin", "norflox",
    "tinidazole",
    "ornidazole",
    "multivitamin",
    "folic acid",
    "iron", "ferrous",
    "calcium",
    "zinc",
    "b complex",
    // Common OCR misreads
    "tylenol", "tylenal", "tylanal",
    "tramadal", "tradamol",
    "ladacip",
    "dodo",  // Dolo misread
  ];

  // Map OCR misreads to correct names
  const ocrFixes = {
    "dodo": "Dolo", "dodo 650": "Dolo 650",
    "tylenal": "Tylenol", "tylanal": "Tylenol", "ty lanal": "Tylenol",
    "tramadal": "Tramadol", "tradamol": "Tramadol",
    "ladacip": "Ladacip",
    "paracetomal": "Paracetamol",
    "amoxicilin": "Amoxicillin",
    "azithromicin": "Azithromycin",
  };

  // ══════════════════════════════════════════════
  // MAIN STRATEGY: Parse each line individually
  // Extract name, frequency, and duration from the SAME line
  // ══════════════════════════════════════════════
  for (const rawLine of lines) {
    const lower = rawLine.toLowerCase();

    // Skip header/footer lines
    if (skipRegex.test(lower) && !medPrefixRegex.test(lower)) {
      medPrefixRegex.lastIndex = 0;
      continue;
    }
    medPrefixRegex.lastIndex = 0;

    // Detect medicine line
    const hasMedPrefix = medPrefixRegex.test(lower);
    medPrefixRegex.lastIndex = 0;
    const hasFreq = freqPatterns.some((fp) => fp.regex.test(lower));
    const hasDosage = dosageRegex.test(lower);
    const hasLineNum = lineNumRegex.test(lower);
    // Check for known medicine (also check OCR misreads)
    let matchedKnown = null;
    for (const m of knownMeds) {
      if (m.length >= 3 && lower.includes(m)) { matchedKnown = m; break; }
    }
    // Also check OCR misreads
    if (!matchedKnown) {
      for (const [wrong] of Object.entries(ocrFixes)) {
        if (lower.includes(wrong)) { matchedKnown = wrong; break; }
      }
    }
    // Also try joining split words: "PARAEET AMOL" → "paraeetamol" → match "paracetamol"
    if (!matchedKnown) {
      const joined = lower.replace(/\s+/g, "");
      for (const m of knownMeds) {
        if (m.length >= 5 && joined.includes(m)) { matchedKnown = m; break; }
      }
    }

    const hasKnownMed = !!matchedKnown;

    if (hasMedPrefix || hasKnownMed || (hasFreq && (hasDosage || hasLineNum)) || (hasLineNum && hasDosage)) {
      // ── Extract frequency FROM THIS LINE ──
      let freq = { m: 1, a: 0, n: 1 };
      let freqLabel = "1-0-1";
      for (const fp of freqPatterns) {
        if (fp.regex.test(lower)) {
          freq = { m: fp.m, a: fp.a, n: fp.n };
          freqLabel = fp.label;
          break;
        }
      }

      // ── Extract duration FROM THIS LINE ──
      let duration = 5;
      for (const dp of durationPatterns) {
        const m = lower.match(dp.regex);
        if (m) {
          let d = parseInt(m[1], 10) * dp.multiplier;
          if (d > 0 && d <= 180) duration = d;
          break;
        }
      }

      // ── Extract medicine name ──
      let name = rawLine;
      name = name.replace(lineNumRegex, "").trim();
      // Remove frequency pattern from name
      for (const fp of freqPatterns) name = name.replace(fp.regex, "").trim();
      // Remove duration from name
      for (const dp of durationPatterns) name = name.replace(dp.regex, "").trim();
      // Extract dosage
      const dosageMatch = name.match(dosageRegex);
      const dosage = dosageMatch ? dosageMatch[1].trim() : "";
      name = name.replace(dosageRegex, "").trim();
      // Remove prefix
      name = name.replace(/^(tab|cap|syp|syr|inj|oint|cream|drops?|susp|gel)\.?\s*/i, "").trim();
      // Remove noise
      name = name.replace(/\b(after|before|with|empty\s*stomach)\s*(food|meals?|breakfast|lunch|dinner)?\b/gi, "").trim();
      name = name.replace(/\b(sos|prn|stat|od|bd|tds|tid|qid|hs|ac|pc|po)\b/gi, "").trim();
      // Clean special chars
      name = name.replace(/[^a-zA-Z0-9\s\-]/g, " ").replace(/\s+/g, " ").trim();

      if (!name || name.length < 3) continue;

      // Apply OCR fixes: "PARAEET AMOL" → "Paracetamol"
      const nameJoined = name.toLowerCase().replace(/\s+/g, "");
      for (const [wrong, right] of Object.entries(ocrFixes)) {
        if (name.toLowerCase() === wrong || nameJoined.includes(wrong.replace(/\s+/g, ""))) {
          name = right;
          break;
        }
      }
      // Also fix by checking known meds against joined name
      if (matchedKnown) {
        // Use the correct known name
        const fixedName = ocrFixes[matchedKnown] || (matchedKnown.charAt(0).toUpperCase() + matchedKnown.slice(1));
        name = fixedName;
      }

      // Validate
      const words = name.split(/\s+/).filter((w) => w.length > 0);
      const hasRealWord = words.some((w) => w.length >= 3 && /^[a-zA-Z]/.test(w));
      if (!hasRealWord && !hasKnownMed) continue;
      const tinyWords = words.filter((w) => w.length <= 2).length;
      if (tinyWords > words.length * 0.5 && !hasKnownMed) continue;

      // Capitalize
      name = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");

      // Deduplicate
      const key = name.toLowerCase().replace(/\s+/g, "");
      if (seen.has(key)) continue;
      seen.add(key);

      // Calculate: qty = (morning + afternoon + night) × duration
      const daily = freq.m + freq.a + freq.n;
      const qty = daily * duration;

      medicines.push({ name, dosage, freq, duration, qty, freqLabel });
    }
  }

  // Extract doctor name
  let doctor = null;
  const drMatch = text.match(/dr\.?\s+([a-z][a-z\s.]{2,30})/i);
  if (drMatch) doctor = "Dr. " + drMatch[1].trim().split("\n")[0].replace(/\s+/g, " ");

  console.log(`Parsed ${medicines.length} medicines:`);
  medicines.forEach((m) => console.log(`  ${m.name} ${m.dosage} | ${m.freqLabel} | ${m.duration}d | qty:${m.qty}`));

  return { medicines, doctor };
}

module.exports = { extractTextFromImage, parsePrescriptionText };
