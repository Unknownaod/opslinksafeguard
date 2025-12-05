// /api/checkout.js
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async (req, res) => {
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 799,
      currency: "usd",
      description: "Safeguard Premier Monthly Subscription",
      automatic_payment_methods: { enabled: true },
      metadata: {
        product: "safeguard-premier",
        userId: req.body?.userId || "anonymous",
      },
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
