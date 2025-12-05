// api/stripe-webhook.js (Express example)
const express = require("express");
const Stripe = require("stripe");
const crypto = require("crypto");
const mongoose = require("mongoose");
const LicenseKey = require("./models/LicenseKey");

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let event;

  try {
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.sendStatus(400);
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object;

    try {
      // generate random license key
      const key =
        "SAFE-" +
        crypto.randomBytes(3).toString("hex").toUpperCase() +
        "-" +
        crypto.randomBytes(2).toString("hex").toUpperCase();

      await LicenseKey.create({
        key,
        plan: "Premier",
        active: false,      // will become active when they run /license activate
        ownerId: null,
        guildId: null
      });

      console.log("🎟️ New Safeguard Premier license created:", key);
    } catch (err) {
      console.error("Failed to create license key:", err);
    }
  }

  res.json({ received: true });
});

module.exports = router;
