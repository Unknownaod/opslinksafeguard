/**********************************************************
 * ENV + CORE
 **********************************************************/
require("dotenv").config();

const express = require("express");
const path = require("path");
const fetch = require("node-fetch").default;
const session = require("express-session");
const cron = require("node-cron");
const Database = require("better-sqlite3");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Stripe = require("stripe");

const app = express();
const PORT = process.env.PORT || 3000;

/**********************************************************
 * SESSION (ADMIN + DASHBOARD)
 **********************************************************/
app.use(
  session({
    secret: process.env.SESSION_SECRET || "supersecret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
  })
);

/**********************************************************
 * STRIPE WEBHOOK (RAW BODY – MUST BE FIRST)
 **********************************************************/
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const licenseKeySchema = require("./models/LicenseKey");

const stripeDB = mongoose
  .createConnection(process.env.MONGO_URI)
  .on("connected", () =>
    console.log("🔗 Stripe License DB connected")
  )
  .on("error", (e) =>
    console.error("❌ Stripe License DB error:", e)
  );

const LicenseKey =
  stripeDB.models.LicenseKey ||
  stripeDB.model("LicenseKey", licenseKeySchema);

function generateLicenseKey() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let key = "SAFE-";
  for (let i = 0; i < 12; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
    if (i === 3 || i === 7) key += "-";
  }
  return key;
}

app.post(
  "/api/stripe-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const sig = req.headers["stripe-signature"];
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );

      if (event.type === "payment_intent.succeeded") {
        const intent = event.data.object;
        const key = generateLicenseKey();

        await LicenseKey.create({
          key,
          paymentId: intent.id,
          plan: intent.metadata?.plan || "Premier",
          active: true
        });

        console.log(`🎟 License created: ${key}`);
      }

      res.sendStatus(200);
    } catch (err) {
      console.error("Webhook error:", err.message);
      res.status(400).send("Webhook Error");
    }
  }
);

/**********************************************************
 * BODY PARSERS (AFTER WEBHOOK)
 **********************************************************/
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**********************************************************
 * SQLITE — STATUS / UPTIME
 **********************************************************/
const db = new Database("uptime.db");

db.exec(`
CREATE TABLE IF NOT EXISTS checks (
  server_id TEXT,
  status TEXT,
  timestamp INTEGER,
  reason TEXT,
  incident_id INTEGER
);
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT,
  title TEXT,
  reason TEXT,
  severity TEXT,
  start_time INTEGER,
  end_time INTEGER
);
CREATE TABLE IF NOT EXISTS incident_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER,
  message TEXT,
  timestamp INTEGER
);
CREATE TABLE IF NOT EXISTS maintenance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT,
  start_time INTEGER,
  end_time INTEGER,
  reason TEXT
);
`);

/**********************************************************
 * SERVER MONITORING
 **********************************************************/
const SERVERS = [
  { id: "c3934795", name: "SafeGuard" },
  { id: "d1435ec6", name: "SafeGuard Premier" },
  { id: "d16160bb", name: "SafeGuard Music" },
  { id: "1d0c90d8", name: "OpsLink Systems" }
];

async function checkServers() {
  for (const s of SERVERS) {
    let status = "down";
    try {
      const r = await fetch(
        `${process.env.PANEL_URL}/api/client/servers/${s.id}/resources`,
        {
          headers: {
            Authorization: `Bearer ${process.env.USER_API_KEY}`
          }
        }
      );
      const j = await r.json();
      const state = j.attributes.current_state;
      status = state === "running" ? "up" : "down";
    } catch {}

    db.prepare(
      `INSERT INTO checks (server_id,status,timestamp)
       VALUES (?,?,?)`
    ).run(s.id, status, Date.now());
  }
}

cron.schedule("*/1 * * * *", checkServers);

/**********************************************************
 * DISCORD OAUTH + MODULES (MongoDB)
 **********************************************************/
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Main MongoDB connected"))
  .catch(console.error);

const moduleSchema = new mongoose.Schema({
  guildId: String,
  id: String,
  name: String,
  description: String,
  enabled: Boolean,
  settings: Object
});

const Module =
  mongoose.models.Module ||
  mongoose.model("Module", moduleSchema);

/**********************************************************
 * AUTH ROUTES
 **********************************************************/
app.get("/auth/discord", (req, res) => {
  const scope = encodeURIComponent("identify guilds");
  res.redirect(
    `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(
      process.env.DISCORD_REDIRECT_URI
    )}&response_type=code&scope=${scope}`
  );
});

app.get("/auth/discord/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect("/");

  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.DISCORD_REDIRECT_URI
  });

  const tokenRes = await fetch(
    "https://discord.com/api/oauth2/token",
    {
      method: "POST",
      body: params,
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    }
  );

  const oauth = await tokenRes.json();
  const userRes = await fetch(
    "https://discord.com/api/users/@me",
    {
      headers: { Authorization: `Bearer ${oauth.access_token}` }
    }
  );

  const user = await userRes.json();
  const token = jwt.sign(
    { user, access_token: oauth.access_token },
    process.env.SESSION_SECRET,
    { expiresIn: "1h" }
  );

  res.redirect("/?token=" + token);
});

/**********************************************************
 * STRIPE CHECKOUT + BILLING
 **********************************************************/
app.post("/api/checkout", async (_, res) => {
  const pi = await stripe.paymentIntents.create({
    amount: 799,
    currency: "usd",
    automatic_payment_methods: { enabled: true }
  });
  res.json({ clientSecret: pi.client_secret });
});

app.post("/api/billing/portal", async (req, res) => {
  const session = await stripe.billingPortal.sessions.create({
    customer: req.body.customerId,
    return_url: "https://www.opslinksafeguard.xyz/billing"
  });
  res.json({ url: session.url });
});

/**********************************************************
 * STATIC FILES + CLEAN URLS
 **********************************************************/
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_, res) =>
  res.sendFile(path.join(__dirname, "public/home.html"))
);

app.use((_, res) =>
  res.sendFile(path.join(__dirname, "public/home.html"))
);

/**********************************************************
 * START SERVER
 **********************************************************/
app.listen(PORT, () =>
  console.log(`✅ Safeguard running → http://localhost:${PORT}`)
);
