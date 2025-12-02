// server.js
const express = require("express");
const jwt = require("jsonwebtoken");
const path = require("path");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

dotenv.config();

const app = express();
app.use(express.json());

/* ================================
   ENV
================================ */
const {
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  DISCORD_REDIRECT_URI,
  SESSION_SECRET,
  BOT_TOKEN,
  MONGODB_URI
} = process.env;

if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !DISCORD_REDIRECT_URI || !SESSION_SECRET) {
  console.warn("⚠️ Missing one or more Discord/SESSION env vars.");
}
if (!MONGODB_URI) {
  console.warn("⚠️ MONGODB_URI is not set.");
}

/* ================================
   STATIC
================================ */
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

/* ================================
   DB
================================ */
mongoose
  .connect(MONGODB_URI, { })
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection failed:", err));

const moduleSchema = new mongoose.Schema({
  guildId: String,
  id: String,          // e.g. "welcome", "verification"
  name: String,
  description: String,
  enabled: { type: Boolean, default: false },
  settings: { type: Object, default: {} }
});
const Module = mongoose.model("Module", moduleSchema);

/* Default module catalogue used when a guild is first opened in the panel */
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

/* Ensure a guild has all default modules created */
async function ensureModulesForGuild(guildId) {
  const existing = await Module.find({ guildId });
  if (existing.length >= DEFAULT_MODULE_CATALOGUE.length) return;

  const ops = DEFAULT_MODULE_CATALOGUE.map(m => ({
    updateOne: {
      filter: { guildId, id: m.id },
      update: {
        $setOnInsert: {
          guildId,
          id: m.id,
          name: m.name,
          description: m.description,
          enabled: m.enabled,
          settings: {}
        }
      },
      upsert: true
    }
  }));

  if (ops.length) {
    await Module.bulkWrite(ops);
    console.log(`✅ Seeded modules for guild ${guildId}`);
  }
}

/* node-fetch helper (works in CommonJS) */
const fetch = (...args) =>
  import("node-fetch").then(({ default: fn }) => fn(...args));


/* ================================
   TRANSCRIPTS MODEL
================================ */
const transcriptMessageSchema = new mongoose.Schema({
  id: String,
  authorId: String,
  authorTag: String,
  authorAvatar: String,
  createdAt: Date,
  content: String,
  attachments: [
    {
      url: String,
      name: String,
      contentType: String
    }
  ]
}, { _id: false });

const transcriptSchema = new mongoose.Schema({
  shortId: { type: String, unique: true, index: true },
  guildId: String,
  guildName: String,
  channelId: String,
  channelName: String,
  ticketId: String,
  openedBy: Object,
  closedBy: Object,
  createdAt: Date,
  closedAt: Date,
  messages: [transcriptMessageSchema]
}, { timestamps: true });

const Transcript = mongoose.model("Transcript", transcriptSchema);

/* ================================
   AUTH / USER ROUTES
================================ */
app.get("/", (_, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

app.get("/auth/discord", (req, res) => {
  const scope = encodeURIComponent("identify guilds");
  const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}` +
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

    // The frontend JS stores this in localStorage.
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

/* ================================
   GUILDS ENDPOINT
================================ */
app.get("/api/guilds", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Missing token" });

  try {
    const decoded = jwt.verify(auth.split(" ")[1], SESSION_SECRET);
    const access = decoded.access_token;

    // User guilds
    const userRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${access}` }
    });
    const userGuilds = await userRes.json();

    // Bot guilds
    const botRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });
    const botGuilds = await botRes.json();
    const botIds = new Set(Array.isArray(botGuilds) ? botGuilds.map(g => g.id) : []);

    // MANAGE_GUILD = 0x20
    const manageable = (Array.isArray(userGuilds) ? userGuilds : [])
      .filter(g => (BigInt(g.permissions ?? 0n) & 0x20n) === 0x20n)
      .map(g => ({ ...g, installed: botIds.has(g.id) }));

    res.json(manageable);
  } catch (err) {
    console.error("Guild fetch error:", err);
    res.status(401).json({ error: "Invalid or expired token" });
  }
});

/* ================================
   MODULE API
================================ */

/* Get all modules for a guild (and auto-create defaults) */
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

/* Toggle enabled flag */
app.post("/api/modules/toggle/:moduleId", async (req, res) => {
  try {
    const mod = await Module.findById(req.params.moduleId);
    if (!mod) return res.status(404).json({ error: "Module not found" });

    mod.enabled = !mod.enabled;
    await mod.save();
    console.log(`🔧 Toggled module ${mod.id} (${mod.guildId}) → ${mod.enabled}`);
    res.json({ success: true, enabled: mod.enabled });
  } catch (err) {
    console.error("Toggle module error:", err);
    res.status(500).json({ error: "Failed to toggle module" });
  }
});

/* Update settings object */
app.post("/api/modules/update/:moduleId", async (req, res) => {
  try {
    const mod = await Module.findById(req.params.moduleId);
    if (!mod) return res.status(404).json({ error: "Module not found" });

    const newSettings = req.body.settings || {};
    mod.settings = newSettings;
    await mod.save();
    console.log(`💾 Updated settings for ${mod.id} (${mod.guildId})`);
    res.json({ success: true, settings: mod.settings });
  } catch (err) {
    console.error("Update module settings error:", err);
    res.status(500).json({ error: "Failed to update module" });
  }
});

/* ================================
   STATIC ROUTES
================================ */
app.get("/dashboard", (_, res) =>
  res.sendFile(path.join(publicPath, "dashboard.html"))
);

app.get("/dashboard/:id", (_, res) =>
  res.sendFile(path.join(publicPath, "dashboard-guild.html"))
);


/* ================================
   TRANSCRIPT API + VIEWER
================================ */
const crypto = require("crypto");

function requireTranscriptKey(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!process.env.SG_TRANSCRIPT_KEY || token !== process.env.SG_TRANSCRIPT_KEY)
    return res.status(401).json({ error: "Unauthorized" });
  next();
}

// POST /api/transcripts — called by the bot
app.post("/api/transcripts", requireTranscriptKey, async (req, res) => {
  try {
    const shortId = crypto.randomBytes(4).toString("hex").toUpperCase();
    const transcript = await Transcript.create({ shortId, ...req.body });
    const url = `https://safeguard.opslinkcad.com/t/${shortId}`;
    res.json({ id: transcript._id, shortId, url });
  } catch (err) {
    console.error("Transcript save failed:", err);
    res.status(500).json({ error: "Failed to save transcript" });
  }
});

// GET /t/:shortId — View transcript
app.get("/t/:shortId", async (req, res) => {
  try {
    const t = await Transcript.findOne({ shortId: req.params.shortId }).lean();
    if (!t) return res.status(404).send("Transcript not found");

    const html = buildTranscriptHtml(t);
    res.send(html);
  } catch (err) {
    console.error("Transcript view error:", err);
    res.status(500).send("Internal error");
  }
});

function buildTranscriptHtml(t) {
  const msgs = t.messages.map(m => `
    <div class="msg">
      <div class="header">
        <img src="${m.authorAvatar}" class="pfp"/>
        <b>${m.authorTag}</b> <span class="time">${new Date(m.createdAt).toLocaleString()}</span>
      </div>
      <div class="content">${escapeHtml(m.content || "")}</div>
      ${(m.attachments || []).map(a => `<a href="${a.url}" class="att">${a.name}</a>`).join("<br>")}
    </div>
  `).join("");

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <title>Safeguard Transcript – ${t.ticketId}</title>
    <style>
      body { background:#04060d; color:#e5e7eb; font-family:Segoe UI, sans-serif; padding:30px; }
      h1 { color:#ff6600; }
      .msg { background:#0b1220; padding:12px; border-radius:12px; margin:10px 0; }
      .pfp { width:32px; height:32px; border-radius:50%; vertical-align:middle; margin-right:6px; }
      .time { font-size:11px; color:#9ca3af; margin-left:6px; }
      .content { white-space:pre-wrap; margin-top:6px; }
      .att { color:#ff944d; text-decoration:none; }
      .att:hover { text-decoration:underline; }
    </style>
  </head>
  <body>
    <h1>Safeguard Transcript</h1>
    <p>Ticket: ${t.ticketId} • Opened by ${t.openedBy?.tag || "Unknown"} • Closed by ${t.closedBy?.tag || "Unknown"}</p>
    <hr/>
    ${msgs}
  </body>
  </html>`;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[c]));
}


/* ================================
   START (local) / EXPORT (Vercel)
================================ */
const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`✅ Safeguard panel on port ${PORT}`));
}

module.exports = app;
