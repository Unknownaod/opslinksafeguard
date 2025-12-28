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
const Database = require("better-sqlite3");
const cron = require("node-cron");
const fetch = (...args) => import("node-fetch").then(({ default: fn }) => fn(...args));

/*********************************************************
 * EXPRESS APP
 *********************************************************/
const app = express();
const PORT = process.env.PORT || 3000;

/*********************************************************
 * SESSION
 *********************************************************/
app.use(
  session({
    secret: process.env.SESSION_SECRET || "supersecret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  })
);

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
} = process.env;

/*********************************************************
 * STRIPE INIT
 *********************************************************/
const stripe = new Stripe(STRIPE_SECRET_KEY);

/*********************************************************
 * STRIPE LICENSE DB (Dedicated Mongoose Connection)
 *********************************************************/
const mongooseStripe = require("mongoose");
const licenseKeySchema = require("./models/LicenseKey");

const webhookDB = mongooseStripe
  .createConnection(MONGODB_URI, {})
  .on("connected", () => console.log("🔗 Stripe License DB connected"))
  .on("error", (err) => console.error("❌ Stripe License DB error:", err));

const LicenseKey =
  webhookDB.models.LicenseKey || webhookDB.model("LicenseKey", licenseKeySchema);

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
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        STRIPE_WEBHOOK_SECRET
      );

      if (event.type === "payment_intent.succeeded") {
        const intent = event.data.object;
        const licenseKey = generateLicenseKey();

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
 * BODY PARSERS (after webhook)
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
 * SQLITE STATUS DB
 *********************************************************/
const SERVERS = [
  { id: "c3934795", name: "SafeGuard" },
  { id: "d1435ec6", name: "SafeGuard Premier" },
  { id: "d16160bb", name: "SafeGuard Music" },
  { id: "1d0c90d8", name: "OpsLink Systems" },
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
 * ADMIN AUTH
 *********************************************************/
function requireAdmin(req, res, next) {
  if (!req.session.admin) return res.status(401).json({ error: "Unauthorized" });
  next();
}

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
 * SERVER CHECKS CRON
 *********************************************************/
function inferDownReason(state, apiFailed) {
  if (apiFailed) return "Monitoring system could not reach the server";
  if (state === "offline") return "Server is offline";
  if (state === "stopping") return "Server is stopping";
  return "Service became unavailable";
}

async function checkServers() {
  for (const s of SERVERS) {
    let status = "down",
      reason = null,
      apiFailed = false;

    try {
      const r = await fetch(`${PANEL_URL}/api/client/servers/${s.id}/resources`, {
        headers: { Authorization: `Bearer ${USER_API_KEY}` },
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

    const last = db
      .prepare(
        `SELECT status, incident_id FROM checks WHERE server_id=? ORDER BY timestamp DESC LIMIT 1`
      )
      .get(s.id);

    let incidentId = last?.incident_id || null;

    if (last?.status !== "down" && status === "down") {
      const result = db
        .prepare(
          `INSERT INTO incidents (server_id,title,reason,severity,start_time) VALUES (?,?,?,?,?)`
        )
        .run(s.id, `${s.name} outage`, reason || "Service unavailable", "critical", Date.now());
      incidentId = result.lastInsertRowid;
      db.prepare(
        `INSERT INTO incident_updates (incident_id,message,timestamp) VALUES (?,?,?)`
      ).run(incidentId, "Service went offline", Date.now());
      logDiscord("🚨 Service Down", `**${s.name}**\n${reason}`, 0xef4444);
    }

    if (last?.status === "down" && status !== "down" && last.incident_id) {
      db.prepare(`UPDATE incidents SET end_time=? WHERE id=?`).run(Date.now(), last.incident_id);
      db.prepare(
        `INSERT INTO incident_updates (incident_id,message,timestamp) VALUES (?,?,?)`
      ).run(last.incident_id, "Service restored", Date.now());
      logDiscord("<✅> Service Restored", `**${s.name}** is operational`, 0x22c55e);
      incidentId = null;
    }

    db.prepare(
      `INSERT INTO checks (server_id,status,timestamp,reason,incident_id) VALUES (?,?,?,?,?)`
    ).run(s.id, status, Date.now(), reason, incidentId);
  }
}

if (!global.__CRON_STARTED__) {
  cron.schedule("*/1 * * * *", checkServers);
  checkServers();
  global.__CRON_STARTED__ = true;
}

/*********************************************************
 * MODULE SCHEMA & DEFAULTS
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

  if (ops.length) {
    await Module.bulkWrite(ops);
    console.log(`✅ Seeded modules for guild ${guildId}`);
  }
}

/*********************************************************
 * STATUS API
 *********************************************************/
app.get("/api/status", (req, res) => {
  const now = Date.now();
  const RANGE = 90 * 86400000;
  const INCIDENT_RANGE = 30 * 86400000;

  const services = SERVERS.map((s) => {
    const rows = db
      .prepare(
        `SELECT status,timestamp,reason,incident_id FROM checks WHERE server_id=? AND timestamp>? ORDER BY timestamp ASC`
      )
      .all(s.id, now - RANGE);

    return {
      id: s.id,
      name: s.name,
      status: rows.at(-1)?.status || "down",
      history: rows,
      incident: db.prepare(`SELECT * FROM incidents WHERE server_id=? AND end_time IS NULL`).get(s.id),
    };
  });

  const incidents = db
    .prepare(`SELECT * FROM incidents WHERE start_time>? ORDER BY start_time DESC`)
    .all(now - INCIDENT_RANGE);

  const maintenance = db
    .prepare(
      `SELECT * FROM maintenance WHERE start_time<=? AND end_time>=? ORDER BY start_time DESC LIMIT 1`
    )
    .get(now, now);

  res.json({ services, incidents, maintenance, lastUpdate: now });
});

/*********************************************************
 * DISCORD OAUTH / USER / GUILDS
 *********************************************************/
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
      scope: "identify guilds",
    });

    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      body: params,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const oauthData = await tokenRes.json();
    if (!oauthData.access_token) return res.redirect("/?error=oauth_failed");

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${oauthData.access_token}` },
    });
    const user = await userRes.json();

    const token = jwt.sign({ user, access_token: oauthData.access_token }, process.env.SESSION_SECRET, {
      expiresIn: "1h",
    });

    res.redirect("/?token=" + encodeURIComponent(token));
  } catch (err) {
    console.error("Discord OAuth error:", err);
    res.redirect("/?error=oauth_failed");
  }
});

app.get("/api/user", (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.json({ loggedIn: false });

  try {
    const decoded = jwt.verify(auth.split(" ")[1], process.env.SESSION_SECRET);
    res.json({ loggedIn: true, user: decoded.user });
  } catch {
    res.json({ loggedIn: false });
  }
});

app.get("/api/guilds", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Missing token" });

  try {
    const decoded = jwt.verify(auth.split(" ")[1], process.env.SESSION_SECRET);
    const access = decoded.access_token;

    // User guilds (OAuth)
    const userRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${access}` }
    });
    const userGuilds = await userRes.json();

    // Bot guilds
    const botRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });
    const botGuilds = await botRes.json();
    const botIds = new Set(
      Array.isArray(botGuilds) ? botGuilds.map((g) => g.id) : []
    );

    // Manageable guilds (user has MANAGE_GUILD)
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

/*********************************************************
 * MODULE ROUTES
 *********************************************************/
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
    const moduleId = req.params.moduleId;
    const { guildId, enabled } = req.body || {};

    if (!guildId) {
      return res.status(400).json({ error: "Missing guildId in body" });
    }

    const mod = await Module.findOne({ guildId, id: moduleId });
    if (!mod) {
      return res.status(404).json({ error: "Module not found" });
    }

    if (typeof enabled === "boolean") {
      mod.enabled = enabled;
    } else {
      mod.enabled = !mod.enabled;
    }

    await mod.save();
    console.log(`🔧 Toggled module ${mod.id} (${mod.guildId}) → ${mod.enabled}`);
    res.json({ success: true, enabled: mod.enabled });
  } catch (err) {
    console.error("Toggle module error:", err);
    res.status(500).json({ error: "Failed to toggle module" });
  }
});

app.post("/api/modules/update/:moduleId", async (req, res) => {
  try {
    const moduleId = req.params.moduleId;
    const { guildId, settings } = req.body || {};

    if (!guildId) {
      return res.status(400).json({ error: "Missing guildId in body" });
    }

    const mod = await Module.findOne({ guildId, id: moduleId });
    if (!mod) {
      return res.status(404).json({ error: "Module not found" });
    }

    mod.settings = settings || {};
    await mod.save();

    console.log(`💾 Updated settings for ${mod.id} (${mod.guildId})`);
    res.json({ success: true, settings: mod.settings });
  } catch (err) {
    console.error("Update module settings error:", err);
    res.status(500).json({ error: "Failed to update module" });
  }
});

/*********************************************************
 * STATIC PAGE ROUTES
 *********************************************************/
const pages = [
  "home",
  "admin-login",
  "admin",
  "billing",
  "bots",
  "checkout",
  "docs",
  "panel",
  "premier",
  "status",
];

pages.forEach((page) => {
  app.get(`/${page}`, (_, res) => {
    res.sendFile(path.join(publicPath, `${page}.html`));
  });
});

app.get("/dashboard", (_, res) =>
  res.sendFile(path.join(publicPath, "dashboard.html"))
);

app.get("/dashboard/:id", (_, res) =>
  res.sendFile(path.join(publicPath, "dashboard-guild.html"))
);

// Redirect *.html → clean URL
app.get(/.*\.html$/, (req, res) => {
  const clean = req.path.replace(/\.html$/, "");
  res.redirect(301, clean === "/home" ? "/" : clean);
});

// Home route
app.get("/", (_, res) => res.sendFile(path.join(publicPath, "home.html")));

// 404 fallback
app.use((req, res) => res.status(404).sendFile(path.join(publicPath, "home.html")));

/*********************************************************
 * MONGODB MAIN CONNECTION
 *********************************************************/
mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

/*********************************************************
 * START SERVER
 *********************************************************/
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`✅ Safeguard panel running → http://localhost:${PORT}`));
}

module.exports = app;
