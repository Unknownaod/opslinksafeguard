// server.js
const express = require("express");
const jwt = require("jsonwebtoken");
const path = require("path");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const Stripe = require("stripe");

dotenv.config();
const app = express();

/* ======================================================
   1️⃣ STRIPE WEBHOOK HANDLER (Dedicated DB Connection)
   ====================================================== */
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// dedicated mongoose connection JUST for Stripe licenses (MONGO_URI)
const mongooseStripe = require("mongoose");
const licenseKeySchema = require("./models/LicenseKey");

const webhookDB = mongooseStripe
  .createConnection(process.env.MONGO_URI, {})
  .on("connected", () =>
    console.log("🔗 Stripe License DB connected (MONGO_URI)")
  )
  .on("error", (err) =>
    console.error("❌ Stripe License DB error:", err)
  );

// avoid OverwriteModelError on Vercel by reusing if exists
const LicenseKey =
  webhookDB.models.LicenseKey ||
  webhookDB.model("LicenseKey", licenseKeySchema);

// Generate Safeguard License
function generateLicenseKey() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let key = "SAFE-";
  for (let i = 0; i < 12; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
    if (i === 3 || i === 7) key += "-";
  }
  return key;
}

// Stripe Webhook – MUST use express.raw ONLY for this route
app.post(
  "/api/stripe-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        endpointSecret
      );

      if (event.type === "payment_intent.succeeded") {
        const intent = event.data.object;
        const licenseKey = generateLicenseKey();

        console.log(`💳 Payment succeeded for ${intent.id}`);
        console.log(`🎟 License generated: ${licenseKey}`);

        await LicenseKey.create({
          key: licenseKey,
          paymentId: intent.id,
          plan: intent.metadata?.plan || "Premier",
          active: true
        });

        console.log("✅ License saved to Stripe License DB.");
      }

      res.status(200).send("Webhook received");
    } catch (err) {
      console.error("⚠️ Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);

/* ======================================================
   2️⃣ EXPRESS JSON PARSERS (after webhook)
   ====================================================== */
// IMPORTANT: must come AFTER the webhook raw handler
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ======================================================
   3️⃣ ENVIRONMENT VARIABLES
   ====================================================== */
const {
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  DISCORD_REDIRECT_URI,
  SESSION_SECRET,
  BOT_TOKEN,
  MONGODB_URI
} = process.env;

if (
  !DISCORD_CLIENT_ID ||
  !DISCORD_CLIENT_SECRET ||
  !DISCORD_REDIRECT_URI ||
  !SESSION_SECRET
) {
  console.warn("⚠️ Missing one or more Discord/SESSION env vars.");
}
if (!MONGODB_URI) {
  console.warn("⚠️ MONGODB_URI is not set.");
}

/* ======================================================
   4️⃣ STATIC FILES
   ====================================================== */
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

/* ======================================================
   5️⃣ DATABASE (MongoDB) — main app DB
   ====================================================== */
mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection failed:", err));

/* ======================================================
   6️⃣ MODULE SCHEMA AND DEFAULTS
   ====================================================== */
const moduleSchema = new mongoose.Schema({
  guildId: String,
  id: String,
  name: String,
  description: String,
  enabled: { type: Boolean, default: false },
  settings: { type: Object, default: {} }
});

// avoid OverwriteModelError in serverless env
const Module =
  mongoose.models.Module || mongoose.model("Module", moduleSchema);

const DEFAULT_MODULE_CATALOGUE = [
  {
    id: "tickets",
    name: "Ticket System",
    description: "Advanced multi-panel ticket system with logging and transcripts.",
    enabled: true
  },
  {
    id: "welcome",
    name: "Welcome / Goodbye / Autorole",
    description: "Welcome cards, goodbye messages, join/leave DMs and autoroles.",
    enabled: true
  },
  {
    id: "verification",
    name: "Captcha Verification",
    description: "Captcha-based verification, staff controls and logging.",
    enabled: true
  },
  {
    id: "leveling",
    name: "Leveling & XP",
    description: "XP per message, level-up channel and role rewards.",
    enabled: false
  },
  {
    id: "logging",
    name: "Moderation Logs",
    description: "Moderation log channel for bans, kicks, warns and more.",
    enabled: true
  },
  {
    id: "auditlogs",
    name: "Audit Logs",
    description: "Tracks joins, leaves and server changes in an audit log channel.",
    enabled: true
  },
  {
    id: "vclogs",
    name: "VC Logs",
    description: "Logs users connecting, disconnecting and moving in voice.",
    enabled: false
  },
  {
    id: "muterole",
    name: "Mute Role",
    description: "Dedicated mute role used by the moderation system.",
    enabled: true
  },
  {
    id: "lockdown",
    name: "Lockdown System",
    description: "Lockdown channels or the whole server during incidents.",
    enabled: true
  },
  {
    id: "antiraid",
    name: "Anti-Raid",
    description: "Protects your server from mass joins and raid behaviour.",
    enabled: true
  },
  {
    id: "automod",
    name: "AutoMod",
    description: "Automatic filtering of links, spam and rule-breaking content.",
    enabled: false
  }
];

async function ensureModulesForGuild(guildId) {
  const existing = await Module.find({ guildId });
  if (existing.length >= DEFAULT_MODULE_CATALOGUE.length) return;

  const ops = DEFAULT_MODULE_CATALOGUE.map((m) => ({
    updateOne: {
      filter: { guildId, id: m.id },
      update: { $setOnInsert: { guildId, ...m, settings: {} } },
      upsert: true
    }
  }));
  if (ops.length) {
    await Module.bulkWrite(ops);
    console.log(`✅ Seeded modules for guild ${guildId}`);
  }
}

/* ======================================================
   7️⃣ NODE-FETCH HELPER
   ====================================================== */
const fetch = (...args) =>
  import("node-fetch").then(({ default: fn }) => fn(...args));

/* ======================================================
   8️⃣ AUTH / USER ROUTES
   ====================================================== */
app.get("/", (_, res) =>
  res.sendFile(path.join(publicPath, "index.html"))
);

app.get("/auth/discord", (req, res) => {
  const scope = encodeURIComponent("identify guilds");
  const url =
    `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}` +
    `&response_type=code&scope=${scope}`;
  res.redirect(url);
});

app.get("/auth/discord/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect("/?error=no_code");

  try {
    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: DISCORD_REDIRECT_URI,
      scope: "identify guilds"
    });

    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      body: params,
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });
    const oauthData = await tokenRes.json();
    if (!oauthData.access_token) {
      console.error("OAuth token error:", oauthData);
      return res.redirect("/?error=oauth_failed");
    }

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${oauthData.access_token}` }
    });
    const user = await userRes.json();

    const token = jwt.sign(
      { user, access_token: oauthData.access_token },
      SESSION_SECRET,
      { expiresIn: "1h" }
    );

    res.redirect("/?token=" + encodeURIComponent(token));
  } catch (err) {
    console.error("OAuth error:", err);
    res.redirect("/?error=oauth_failed");
  }
});

app.get("/api/user", (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.json({ loggedIn: false });

  try {
    const decoded = jwt.verify(auth.split(" ")[1], SESSION_SECRET);
    res.json({ loggedIn: true, user: decoded.user });
  } catch {
    res.json({ loggedIn: false });
  }
});

/* ======================================================
   9️⃣ GUILD ROUTES
   ====================================================== */
app.get("/api/guilds", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Missing token" });

  try {
    const decoded = jwt.verify(auth.split(" ")[1], SESSION_SECRET);
    const access = decoded.access_token;

    const userRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${access}` }
    });
    const userGuilds = await userRes.json();

    const botRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });
    const botGuilds = await botRes.json();
    const botIds = new Set(
      Array.isArray(botGuilds) ? botGuilds.map((g) => g.id) : []
    );

    const manageable = (Array.isArray(userGuilds) ? userGuilds : [])
      .filter(
        (g) => (BigInt(g.permissions ?? 0n) & 0x20n) === 0x20n
      )
      .map((g) => ({ ...g, installed: botIds.has(g.id) }));

    res.json(manageable);
  } catch (err) {
    console.error("Guild fetch error:", err);
    res.status(401).json({ error: "Invalid or expired token" });
  }
});

/* ======================================================
   🔟 MODULE ROUTES
   ====================================================== */
app.get("/api/modules/:guildId", async (req, res) => {
  try {
    const guildId = req.params.guildId;
    await ensureModulesForGuild(guildId);
    const modules = await Module.find({ guildId }).sort({ name: 1 });
    res.json(modules);
  } catch (err) {
    console.error("Get modules error:", err);
    res.status(500).json({ error: "Failed to load modules" });
  }
});

app.post("/api/modules/toggle/:moduleId", async (req, res) => {
  try {
    const mod = await Module.findById(req.params.moduleId);
    if (!mod) return res.status(404).json({ error: "Module not found" });

    mod.enabled = !mod.enabled;
    await mod.save();
    console.log(
      `🔧 Toggled module ${mod.id} (${mod.guildId}) → ${mod.enabled}`
    );
    res.json({ success: true, enabled: mod.enabled });
  } catch (err) {
    console.error("Toggle module error:", err);
    res.status(500).json({ error: "Failed to toggle module" });
  }
});

app.post("/api/modules/update/:moduleId", async (req, res) => {
  try {
    const mod = await Module.findById(req.params.moduleId);
    if (!mod) return res.status(404).json({ error: "Module not found" });

    mod.settings = req.body.settings || {};
    await mod.save();
    console.log(`💾 Updated settings for ${mod.id} (${mod.guildId})`);
    res.json({ success: true, settings: mod.settings });
  } catch (err) {
    console.error("Update module settings error:", err);
    res.status(500).json({ error: "Failed to update module" });
  }
});

/* ======================================================
   11️⃣ STRIPE CHECKOUT
   ====================================================== */
app.post("/api/checkout", async (req, res) => {
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 799,
      currency: "usd",
      description: "OpsLink Safeguard Premier Subscription",
      automatic_payment_methods: { enabled: true },
      metadata: {
        product_name: "Safeguard Premier",
        product_id: "prod_TY80HIQVXTvUVA",
        price_id: "price_1Sb1kpLQjsrxMZMFbEhl3Bjm",
        plan: "Premier",
        billing_cycle: "monthly",
        type: "license"
      }
    });

    res.status(200).json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("❌ Stripe Checkout Error:", err);
    res
      .status(500)
      .json({ error: "Stripe Checkout Failed", message: err.message });
  }
});

/* ======================================================
   12️⃣ SUCCESS ROUTE (uses Stripe License DB)
   ====================================================== */
app.get("/success/:paymentId", async (req, res) => {
  try {
    const paymentId = req.params.paymentId;

    const license = await LicenseKey.findOne({ paymentId });

    if (!license) {
      return res.status(404).send(`
        <h1>❌ Access Denied</h1>
        <p>No valid Safeguard license found for this payment.</p>
      `);
    }

    const session = await stripe.paymentIntents.retrieve(paymentId);
    if (session.status !== "succeeded") {
      return res.status(403).send(`
        <h1>❌ Payment Not Completed</h1>
        <p>Your payment exists, but it was not marked as paid.</p>
      `);
    }

    return res.send(`
      <h1>🎉 Thank you for your purchase!</h1>
      <p>Your Safeguard Premier license key:</p>
      <code style="font-size:22px; font-weight:bold;">${license.key}</code>
      <p>Store this key safely. You will need it to activate Safeguard.</p>
    `);
  } catch (err) {
    console.error("Success Route Error:", err);
    return res.status(500).send(`
      <h1>⚠️ Internal Error</h1>
      <p>${err.message}</p>
    `);
  }
});

app.post("/api/billing/portal", async (req, res) => {
  try {
    const { customerId } = req.body;

    if (!customerId) {
      return res.status(400).json({
        error: "Missing customerId",
        message: "A Stripe customer ID must be provided to access the billing portal."
      });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: "https://www.opslinksafeguard.xyz/billing"
    });

    return res.json({ url: session.url });

  } catch (err) {
    console.error("Billing Portal Error:", err);
    return res.status(500).json({
      error: "Failed to create billing portal",
      message: err.message
    });
  }
});


/* ======================================================
   13️⃣ STATIC PAGES
   ====================================================== */
app.get("/dashboard", (_, res) =>
  res.sendFile(path.join(publicPath, "dashboard.html"))
);
app.get("/dashboard/:id", (_, res) =>
  res.sendFile(path.join(publicPath, "dashboard-guild.html"))
);

/* ======================================================
   14️⃣ STARTUP
   ====================================================== */
const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
  app.listen(PORT, () =>
    console.log(`✅ Safeguard panel running on port ${PORT}`)
  );
}
module.exports = app;
