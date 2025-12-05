// api/checkout.js
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // === Product Info ===
    const productName = "SafeGuard Premier";
    const productDescription = "Monthly license subscription for OpsLink SafeGuard Premier";
    const priceInCents = 799; // $7.99 CAD/USD (depending on your Stripe account)
    const currency = "cad"; // or "usd" if your Stripe account uses USD

    // === Create Stripe PaymentIntent ===
    const paymentIntent = await stripe.paymentIntents.create({
      amount: priceInCents,
      currency,
      description: `${productName} – ${productDescription}`,
      automatic_payment_methods: { enabled: true },
      metadata: {
        product: productName,
        plan: "Premier",
        billing_cycle: "monthly",
        type: "license"
      }
    });

    // === Return client secret to frontend ===
    res.status(200).json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("❌ Stripe Checkout Error:", err);
    res.status(500).json({ error: "Internal Server Error", message: err.message });
  }
};
