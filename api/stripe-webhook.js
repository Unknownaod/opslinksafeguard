// api/stripe-webhook.js
const express = require("express");
const Stripe = require("stripe");
const crypto = require("crypto");
const mongoose = require("mongoose");
const LicenseKey = require("./models/LicenseKey");

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ⚙️ Stripe sends raw JSON, so we need express.raw middleware here:
router.post("/api/stripe-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let event;

  try {
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ✅ Handle successful payment event
  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object;
    const productName = paymentIntent.metadata?.product || "Unknown Product";

    console.log(`💰 Payment successful for: ${productName}`);

    if (productName === "SafeGuard Premier") {
      try {
        // Generate random license key
        const licenseKey =
          "SAFE-" +
          crypto.randomBytes(3).toString("hex").toUpperCase() +
          "-" +
          crypto.randomBytes(2).toString("hex").toUpperCase();

        // Store in MongoDB
        await LicenseKey.create({
          key: licenseKey,
          plan: "Premier",
          active: false,
          ownerId: null,
          guildId: null,
          createdAt: new Date(),
        });

        console.log(`🎟️ New SafeGuard Premier license generated: ${licenseKey}`);
      } catch (err) {
        console.error("❌ Failed to create license key:", err);
      }
    }
  }

  res.json({ received: true });
});

module.exports = router;
