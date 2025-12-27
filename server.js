/*********************************************************
 * ENV
 *********************************************************/
require("dotenv").config();

/*********************************************************
 * CORE IMPORTS
 *********************************************************/
const express = require("express");
const path = require("path");
const cron = require("node-cron");
const session = require("express-session");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const mongoose = require("mongoose");
const Stripe = require("stripe");

/*********************************************************
 * NODE-FETCH (SAFE FOR BOTH FILES)
 *********************************************************/
const fetch = (...args) =>
  import("node-fetch").then(({ default: fn }) => fn(...args));

/*********************************************************
 * EXPRESS APP (SINGLE INSTANCE)
 *********************************************************/
const app = express();
const PORT = process.env.PORT || 3000;

/*********************************************************
 * STRIPE INIT
 *********************************************************/
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/*********************************************************
 * STRIPE LICENSE DATABASE (DEDICATED)
 *********************************************************/
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

const LicenseKey =
  webhookDB.models.LicenseKey ||
  webhookDB.model("LicenseKey", licenseKeySchema);

/*********************************************************
 * STRIPE WEBHOOK (RAW — MUST BE FIRST)
 *********************************************************/
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
    const sig = req.headers["stripe-signature"];
    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );

      if (event.type === "payment_intent.succeeded") {
        const intent = event.data.object;
        const licenseKey = generateLicenseKey();

        await LicenseKey.create({
          key: licenseKey,
          paymentId: intent.id,
          plan: intent.metadata?.plan || "Premier",
          active: true
        });

        console.log(`🎟 License generated: ${licenseKey}`);
      }

      res.status(200).send("Webhook received");
    } catch (err) {
      console.error("⚠️ Webhook verification failed:", err.message);
      res.status(400).send(err.message);
    }
  }
);

/*********************************************************
 * BODY PARSERS (AFTER WEBHOOK)
 *********************************************************/
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/*********************************************************
 * SESSION
 *********************************************************/
app.use(
  session({
    secret: process.env.SESSION_SECRET || "supersecret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
  })
);

/*********************************************************
 * ENV CONFIG
 *********************************************************/
const {
  PANEL_URL,
  USER_API_KEY,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  DISCORD_WEBHOOK_URL,
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  DISCORD_REDIRECT_URI,
  BOT_TOKEN,
  MONGODB_URI
} = process.env;

/*********************************************************
 * DISCORD LOGGER
 *********************************************************/
async function logDiscord(title, description, color = 0xff7a18) {
  if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL.includes("YOUR_")) return;
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{ title, description, color, timestamp: new Date().toISOString() }]
      })
    });
  } catch {}
}

/*********************************************************
 * SQLITE STATUS DATABASE
 *********************************************************/
const SERVERS = [
  { id: "c3934795", name: "SafeGuard" },
  { id: "d1435ec6", name: "SafeGuard Premier" },
  { id: "d16160bb", name: "SafeGuard Music" },
  { id: "1d0c90d8", name: "OpsLink Systems" }
];

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

/*********************************************************
 * STATUS CHECK CRON (UNCHANGED)
 *********************************************************/
function inferDownReason(state, apiFailed) {
  if (apiFailed) return "Monitoring system could not reach the server";
  if (state === "offline") return "Server is offline";
  if (state === "stopping") return "Server is stopping";
  return "Service became unavailable";
}

async function checkServers() {
  for (const s of SERVERS) {
    let status = "down", reason = null, apiFailed = false;

    try {
      const r = await fetch(`${PANEL_URL}/api/client/servers/${s.id}/resources`, {
        headers: { Authorization: `Bearer ${USER_API_KEY}` }
      });
      const j = await r.json();
      const state = j.attributes.current_state;
      if (state === "running" || state === "starting") status = "up";
      else if (state === "stopping") {
        status = "degraded";
        reason = "Server is stopping";
      } else {
        status = "down";
        reason = inferDownReason(state, false);
      }
    } catch {
      status = "down";
      apiFailed = true;
      reason = inferDownReason(null, true);
    }

    db.prepare(`
      INSERT INTO checks (server_id,status,timestamp,reason)
      VALUES (?,?,?,?)
    `).run(s.id, status, Date.now(), reason);
  }
}

cron.schedule("*/1 * * * *", checkServers);
checkServers();

/*********************************************************
 * STATUS API (UNCHANGED)
 *********************************************************/
app.get("/api/status", (req, res) => {
  const now = Date.now();
  const RANGE = 90 * 86400000;

  const services = SERVERS.map(s => {
    const rows = db.prepare(`
      SELECT status,timestamp,reason
      FROM checks
      WHERE server_id=? AND timestamp>?
      ORDER BY timestamp ASC
    `).all(s.id, now - RANGE);

    return {
      id: s.id,
      name: s.name,
      status: rows.at(-1)?.status || "down",
      history: rows
    };
  });

  res.json({ services, lastUpdate: now });
});

/*********************************************************
 * MONGODB MAIN PANEL DB
 *********************************************************/
mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB error:", err));

/*********************************************************
 * STATIC FILES
 *********************************************************/
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

/*********************************************************
 * CLEAN URL PAGES (RESTORED)
 *********************************************************/
const pages = [
  "admin-login",
  "admin",
  "billing",
  "bots",
  "checkout",
  "docs",
  "panel",
  "premier",
  "status"
];

pages.forEach(page => {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(publicPath, `${page}.html`));
  });
});

/*********************************************************
 * HOME ROUTES (FIXED — NOT REMOVED)
 *********************************************************/
app.get("/", (req, res) => {
  res.sendFile(path.join(publicPath, "home.html"));
});

app.get("/home", (req, res) => {
  res.sendFile(path.join(publicPath, "home.html"));
});

/*********************************************************
 * .HTML → CLEAN URL REDIRECT (RESTORED)
 *********************************************************/
app.get(/.*\.html$/, (req, res) => {
  const clean = req.path.replace(/\.html$/, "");
  res.redirect(301, clean === "/home" ? "/" : clean);
});

/*********************************************************
 * ADMIN AUTH ROUTES (UNCHANGED)
 *********************************************************/
app.post("/api/admin/login", (req, res) => {
  const { email, password } = req.body || {};
  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    req.session.admin = true;
    logDiscord("🔐 Admin Login", email, 0x2563eb);
    return res.json({ success: true });
  }
  res.status(401).json({ error: "Invalid login" });
});

app.get("/api/admin/me", (req, res) => {
  res.json({ admin: !!req.session.admin });
});

app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => {
    logDiscord("🚪 Admin Logout", "Session ended");
    res.json({ success: true });
  });
});

/*********************************************************
 * STRIPE CHECKOUT (UNCHANGED)
 *********************************************************/
app.post("/api/checkout", async (req, res) => {
  const paymentIntent = await stripe.paymentIntents.create({
    amount: 799,
    currency: "usd",
    automatic_payment_methods: { enabled: true }
  });

  res.json({ clientSecret: paymentIntent.client_secret });
});

/*********************************************************
 * SUCCESS PAGE (UNCHANGED)
 *********************************************************/
app.get("/success/:paymentId", async (req, res) => {
  const license = await LicenseKey.findOne({ paymentId: req.params.paymentId });
  if (!license) {
    return res.status(404).send("<h1>❌ No license found</h1>");
  }

  res.send(`
    <h1>🎉 Thank you for your purchase!</h1>
    <code style="font-size:22px">${license.key}</code>
  `);
});

/*********************************************************
 * 404 FALLBACK (RESTORED)
 *********************************************************/
app.use((req, res) => {
  res.status(404).sendFile(path.join(publicPath, "home.html"));
});

/*********************************************************
 * START SERVER
 *********************************************************/
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`✅ Server running → http://localhost:${PORT}`);
  });
}

module.exports = app;
