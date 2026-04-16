const mongoose = require("mongoose");

const medicineSchema = new mongoose.Schema(
{
  name: {
    type: String,
    required: true,
    trim: true
  },

  category: {
    type: String,
    default: "Tablet"
  },

unit: {
  type: String,
  required: true
},

normalizedName: {
  type: String,
  lowercase: true,
  trim: true,
  index: true,
  unique: true   // ✅ ADD THIS
},
  /* PRICING */
  costPrice: {
    type: Number,
    default: 0
  },

  sellingPrice: {
    type: Number,
    default: 0
  },


  /* INVENTORY */
  stock: {
    type: Number,
    default: 0
  },

  minStock: {
    type: Number,
    default: 10
  },

  maxStock: {
    type: Number,
    default: 200
  },

  expiry: Date,

  /* STATUS */
  status: {
    type: String,
    enum: ["Active","Inactive"],
    default: "Active"
  },

  inactiveReason: String,

  /* DEMAND */
  demand30: {
    type: Number,
    default: 0
  },

  demand90: {
    type: Number,
    default: 0
  },

  gstPct: {
    type: Number,
    default: 12
  }

},
{ timestamps: true }
);



/* ===============================
   STOCK STATUS
================================ */

medicineSchema.virtual("stockStatus").get(function(){

  if(this.stock === 0)
    return "Out of Stock";

  if(this.stock <= this.minStock)
    return "Low Stock";

  return "In Stock";

});



/* ===============================
   AUTO REORDER QTY
================================ */

medicineSchema.virtual("autoReorderQty").get(function(){

  if(this.stock >= this.minStock)
    return 0;

  return this.minStock + 20 - this.stock;

});



/* ===============================
   DAYS UNTIL STOCKOUT
================================ */

medicineSchema.virtual("daysUntilStockout").get(function(){

  const dailyUsage = this.demand30 / 30;

  if(dailyUsage === 0)
    return "∞";

  return Math.floor(this.stock / dailyUsage);

});

medicineSchema.pre("save", function () {
  if (this.name) {
    this.normalizedName = this.name
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }
});

/* ===============================
   PROFIT MARGIN
================================ */

medicineSchema.virtual("profitPerUnit").get(function(){
  return (this.sellingPrice || 0) - (this.costPrice || 0);
});

medicineSchema.virtual("profitMargin").get(function(){
  if(!this.sellingPrice) return 0;
  return Math.round(((this.sellingPrice - (this.costPrice || 0)) / this.sellingPrice) * 100);
});


/* ── INDEXES for fast queries at scale ── */
medicineSchema.index({ name: 1 });
medicineSchema.index({ status: 1 });
medicineSchema.index({ expiry: 1 });
medicineSchema.index({ stock: 1, minStock: 1 });

medicineSchema.set("toJSON",{ virtuals:true });
medicineSchema.set("toObject",{ virtuals:true });

module.exports = mongoose.model("Medicine", medicineSchema);