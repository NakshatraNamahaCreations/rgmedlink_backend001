const mongoose = require("mongoose");
const Medicine = require("../models/Medicine");

require("dotenv").config();

async function fix() {
  await mongoose.connect(process.env.MONGO_URI);

  const medicines = await Medicine.find();

  for (let m of medicines) {
    m.normalizedName = m.name
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

    await m.save();
  }

  console.log("✅ normalizedName updated for all medicines");

  process.exit();
}

fix();  