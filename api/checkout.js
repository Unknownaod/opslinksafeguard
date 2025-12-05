// api/checkout.js
const express = require("express");
const Stripe = require("stripe");
const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Custom checkout route for SafeGuard Premier
router.post("/api/checkout", async (req, res) => {
  try {
    // Product details
    const productName = "SafeGuard Premier";
    const productDescription = "Monthly license subscription for OpsLink SafeGuard Premier";
    const priceInCents = 799; // $7.99 USD

    // Create Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: priceInCents,
      currency: "cad",
      description: `${productName} – ${productDescription}`,
      automatic_payment_methods: { enabled: true },
      metadata: {
        product: productName,
        plan: "Premier",
        billing_cycle: "monthly",
        type: "license",
      },
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("❌ Stripe error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
