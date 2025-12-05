// api/checkout.js (Express-style example)
const express = require("express");
const Stripe = require("stripe");
const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.post("/api/checkout", async (req, res) => {
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 799, // $7.99 in cents
      currency: "usd",
      description: "Safeguard Premier Monthly Subscription",
      automatic_payment_methods: { enabled: true },
      metadata: { product: "safeguard-premier" }
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("Stripe error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
