// models/LicenseKey.js
const { Schema, model } = require("mongoose");

const licenseKeySchema = new Schema({
  key: { type: String, required: true, unique: true },
  plan: { type: String, default: "Premier" },
  active: { type: Boolean, default: false },
  ownerId: { type: String, default: null },
  guildId: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});

module.exports = model("LicenseKey", licenseKeySchema);
