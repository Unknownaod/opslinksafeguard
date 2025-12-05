// models/LicenseKey.js
const { Schema } = require("mongoose");

const licenseKeySchema = new Schema({
  key: { type: String, required: true, unique: true },
  paymentId: { type: String, required: true },
  plan: { type: String, default: "Premier" },
  active: { type: Boolean, default: false },
  ownerId: { type: String, default: null },
  guildId: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});

module.exports = licenseKeySchema;
