/*********************************************************
 * ENV & CORE IMPORTS
 *********************************************************/
require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Stripe = require("stripe");
const fetch = (...args) => import("node-fetch").then(({ default: fn }) => fn(...args));

/*********************************************************
 * EXPRESS APP
 *********************************************************/
const app = express();
const PORT = process.env.PORT || 3000;

/*********************************************************
 * FLAGS
 *********************************************************/
const IS_VERCEL = !!process.env.VERCEL;

/*********************************************************
 * SESSION (Serverless-safe, in-memory for local only)
 *********************************************************/
if (!IS_VERCEL) {
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "supersecret",
      resave: false,
      saveUninitialized: true,
      cookie: { secure: false },
    })
  );
}

/*********************************************************
 * ENV VARIABLES
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
  MONGODB_URI,
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  SESSION_SECRET,
} = process.env;

/*********************************************************
 * STRIPE INIT
 *********************************************************/
const stripe = new Stripe(STRIPE_SECRET_KEY);

/*********************************************************
 * MONGODB CONNECTION (CACHED)
 *********************************************************/
let mongoConn;
async function connectMongo() {
  if (mongoConn) return mongoConn;
  mongoConn = await mongoose.connect(MONGODB_URI);
  console.log("✅ MongoDB connected");
  return mongoConn;
}

/*********************************************************
 * STRIPE LICENSE DB (Separate connection)
 *********************************************************/
const licenseKeySchema = require("./models/LicenseKey");
let stripeConn;
async function connectStripeDB() {
  if (stripeConn) return stripeConn;
  stripeConn = mongoose.createConnection(MONGODB_URI);
  stripeConn.model("LicenseKey", licenseKeySchema);
  console.log("🔗 Stripe License DB connected");
  return stripeConn;
}

function generateLicenseKey() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let key = "SAFE-";
  for (let i = 0; i < 12; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
    if (i === 3 || i === 7) key += "-";
  }
  return key;
}

/*********************************************************
 * STRIPE WEBHOOK (RAW)
 *********************************************************/
app.post(
  "/api/stripe-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    try {
      const event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);

      if (event.type === "payment_intent.succeeded") {
        const intent = event.data.object;
        const licenseKey = generateLicenseKey();

        const conn = await connectStripeDB();
        const LicenseKey = conn.model("LicenseKey");

        await LicenseKey.create({
          key: licenseKey,
          paymentId: intent.id,
          plan: intent.metadata?.plan || "Premier",
          active: true,
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
 * BODY PARSERS
 *********************************************************/
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/*********************************************************
 * STATIC FILES
 *********************************************************/
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

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
        embeds: [{ title, description, color, timestamp: new Date().toISOString() }],
      }),
    });
  } catch {}
}

/*********************************************************
 * ADMIN AUTH (JWT — serverless-safe)
 *********************************************************/
app.post("/api/admin/login", (req, res) => {
  const { email, password } = req.body || {};
  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    const token = jwt.sign({ admin: true }, SESSION_SECRET, { expiresIn: "2h" });
    logDiscord("🔐 Admin Login", email);
    return res.json({ token });
  }
  res.status(401).json({ error: "Invalid login" });
});

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  try {
    jwt.verify(auth.split(" ")[1], SESSION_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

/*********************************************************
 * MONGODB MODELS FOR STATUS
 *********************************************************/
const serverSchema = new mongoose.Schema({
  serverId: String,
  name: String,
});
const checkSchema = new mongoose.Schema({
  serverId: String,
  status: String,
  timestamp: { type: Date, default: Date.now },
  reason: String,
  incidentId: { type: mongoose.Schema.Types.ObjectId, ref: "Incident" },
});
const incidentSchema = new mongoose.Schema({
  serverId: String,
  title: String,
  reason: String,
  severity: String,
  startTime: { type: Date, default: Date.now },
  endTime: Date,
});

const ServerModel = mongoose.models.Server || mongoose.model("Server", serverSchema);
const Check = mongoose.models.Check || mongoose.model("Check", checkSchema);
const Incident = mongoose.models.Incident || mongoose.model("Incident", incidentSchema);

/*********************************************************
 * SERVERS
 *********************************************************/
const SERVERS = [
  { serverId: "c3934795", name: "SafeGuard" },
  { serverId: "d1435ec6", name: "SafeGuard Premier" },
  { serverId: "d16160bb", name: "SafeGuard Music" },
  { serverId: "1d0c90d8", name: "OpsLink Systems" },
];

/*********************************************************
 * STATUS CHECK FUNCTION (replaces cron + sqlite)
 *********************************************************/
async function inferDownReason(state, apiFailed) {
  if (apiFailed) return "Monitoring system could not reach the server";
  if (state === "offline") return "Server is offline";
  if (state === "stopping") return "Server is stopping";
  return "Service became unavailable";
}

async function checkServers() {
  await connectMongo();

  for (const s of SERVERS) {
    let status = "down",
      reason = null,
      apiFailed = false;

    try {
      const r = await fetch(`${PANEL_URL}/api/client/servers/${s.serverId}/resources`, {
        headers: { Authorization: `Bearer ${USER_API_KEY}` },
      });
      const j = await r.json();
      const state = j.attributes.current_state;
      if (state === "running" || state === "starting") status = "up";
      else if (state === "stopping") {
        status = "degraded";
        reason = "Server is stopping";
      } else status = "down";
      reason = reason || inferDownReason(state, false);
    } catch {
      status = "down";
      apiFailed = true;
      reason = inferDownReason(null, true);
    }

    const lastCheck = await Check.findOne({ serverId: s.serverId }).sort({ timestamp: -1 });
    let incidentId = lastCheck?.incidentId || null;

    if (lastCheck?.status !== "down" && status === "down") {
      const incident = await Incident.create({
        serverId: s.serverId,
        title: `${s.name} outage`,
        reason: reason || "Service unavailable",
        severity: "critical",
      });
      incidentId = incident._id;
      await Check.create({ serverId: s.serverId, status, reason, incidentId });
      logDiscord("🚨 Service Down", `**${s.name}**\n${reason}`, 0xef4444);
    }

    if (lastCheck?.status === "down" && status !== "down" && lastCheck.incidentId) {
      await Incident.findByIdAndUpdate(lastCheck.incidentId, { endTime: new Date() });
      await Check.create({ serverId: s.serverId, status, reason: null, incidentId: null });
      logDiscord("<✅> Service Restored", `**${s.name}** is operational`, 0x22c55e);
    }

    if (!lastCheck || lastCheck.status !== status) {
      await Check.create({ serverId: s.serverId, status, reason, incidentId });
    }
  }
}

// Example route to trigger status check (can be scheduled in Vercel)
app.get("/api/check-servers", async (req, res) => {
  await checkServers();
  res.json({ success: true });
});

/*********************************************************
 * MODULE SCHEMA & ROUTES
 *********************************************************/
const moduleSchema = new mongoose.Schema({
  guildId: String,
  id: String,
  name: String,
  description: String,
  enabled: { type: Boolean, default: false },
  settings: { type: Object, default: {} },
});

const Module = mongoose.models.Module || mongoose.model("Module", moduleSchema);

const DEFAULT_MODULE_CATALOGUE = [
  { id: "tickets", name: "Ticket System", description: "Advanced multi-panel ticket system with logging and transcripts.", enabled: true },
  { id: "welcome", name: "Welcome / Goodbye / Autorole", description: "Welcome cards, goodbye messages, join/leave DMs and autoroles.", enabled: true },
  { id: "verification", name: "Captcha Verification", description: "Captcha-based verification, staff controls and logging.", enabled: true },
  { id: "leveling", name: "Leveling & XP", description: "XP per message, level-up channel and role rewards.", enabled: false },
  { id: "logging", name: "Moderation Logs", description: "Moderation log channel for bans, kicks, warns and more.", enabled: true },
  { id: "auditlogs", name: "Audit Logs", description: "Tracks joins, leaves and server changes in an audit log channel.", enabled: true },
  { id: "vclogs", name: "VC Logs", description: "Logs users connecting, disconnecting and moving in voice.", enabled: false },
  { id: "muterole", name: "Mute Role", description: "Dedicated mute role used by the moderation system.", enabled: true },
  { id: "lockdown", name: "Lockdown System", description: "Lockdown channels or the whole server during incidents.", enabled: true },
  { id: "antiraid", name: "Anti-Raid", description: "Protects your server from mass joins and raid behaviour.", enabled: true },
  { id: "automod", name: "AutoMod", description: "Automatic filtering of links, spam and rule-breaking content.", enabled: false },
];

async function ensureModulesForGuild(guildId) {
  const existing = await Module.find({ guildId });
  if (existing.length >= DEFAULT_MODULE_CATALOGUE.length) return;

  const ops = DEFAULT_MODULE_CATALOGUE.map((m) => ({
    updateOne: {
      filter: { guildId, id: m.id },
      update: { $setOnInsert: { guildId, ...m, settings: {} } },
      upsert: true,
    },
  }));

  if (ops.length) await Module.bulkWrite(ops);
}

/*********************************************************
 * STATIC PAGE ROUTES
 *********************************************************/
const pages = [
  "home", "admin-login", "admin", "billing", "bots", "checkout", "docs", "panel", "premier", "status"
];

pages.forEach(page => app.get(`/${page}`, (_, res) => res.sendFile(path.join(publicPath, `${page}.html`))));
app.get("/dashboard", (_, res) => res.sendFile(path.join(publicPath, "dashboard.html")));
app.get("/dashboard/:id", (_, res) => res.sendFile(path.join(publicPath, "dashboard-guild.html")));
app.get(/.*\.html$/, (req, res) => res.redirect(301, req.path.replace(/\.html$/, "") === "/home" ? "/" : req.path.replace(/\.html$/, "")));
app.get("/", (_, res) => res.sendFile(path.join(publicPath, "home.html")));
app.use((req, res) => res.status(404).sendFile(path.join(publicPath, "home.html")));

/*********************************************************
 * MONGODB MAIN CONNECTION
 *********************************************************/
connectMongo();

/*********************************************************
 * START SERVER (LOCAL ONLY)
 *********************************************************/
if (!IS_VERCEL) {
  app.listen(PORT, () => console.log(`✅ Safeguard panel running → http://localhost:${PORT}`));
}

module.exports = app;
