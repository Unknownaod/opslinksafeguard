// server.js
const express = require("express");
const jwt = require("jsonwebtoken");
const path = require("path");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
// node-fetch v3 in CommonJS:
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

dotenv.config();

const app = express();
app.use(express.json());

// =====================================
// ENV VARIABLES
// =====================================
const {
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  DISCORD_REDIRECT_URI,
  SESSION_SECRET,
  BOT_TOKEN,
  MONGODB_URI
} = process.env;

// =====================================
// STATIC PATH
// =====================================
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

// =====================================
// CONNECT TO MONGODB
// =====================================
mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection failed:", err));

// =====================================
// MONGOOSE MODELS
// =====================================
const moduleSchema = new mongoose.Schema({
  guildId: String,
  id: String,            // module key (e.g. "tickets", "greet")
  name: String,
  description: String,
  enabled: Boolean,
  settings: Object
});

const Module = mongoose.model("Module", moduleSchema);

// Default module templates — applied per guild on first load
const DEFAULT_MODULES = [
  {
    id: "tickets",
    name: "Ticket System",
    description: "Advanced multi-panel ticket system with logging and transcripts.",
    enabled: true,
    settings: {
      logChannelId: "",
      supportRoleId: "",
      ticketCategoryId: "",
      allowClaim: true,
      transcriptToFile: true,
      transcriptToChannel: true
    }
  },
  {
    id: "greet",
    name: "Welcome & Goodbye",
    description: "Welcome new members, say goodbye, and assign autoroles.",
    enabled: true,
    settings: {
      welcome: {
        enabled: true,
        channelId: "",
        message: "Welcome {mention} to {server}! You are member #{membercount}.",
        dm: "",
        background: ""
      },
      goodbye: {
        enabled: true,
        channelId: "",
        message: "Goodbye {user}, thanks for being part of {server}.",
        dm: "",
        background: ""
      },
      autoroles: [],
      autoroleDelayMs: 0
    }
  },
  {
    id: "verify",
    name: "Captcha Verification",
    description: "Protect your server with captcha-based verification.",
    enabled: true,
    settings: {
      enabled: true,
      panelChannelId: "",
      logChannelId: "",
      roles: [],
      message: "Click Verify to prove you're human.",
      difficulty: {
        mode: "medium",
        length: 5,
        decoys: 10,
        trace: true
      },
      staffRoleId: ""
    }
  },
  {
    id: "level",
    name: "Leveling System",
    description: "XP, ranking cards and level-based role rewards.",
    enabled: true,
    settings: {
      enabled: true,
      xpPerMessage: 10,
      levelChannelId: "",
      roleRewards: [] // [{ level: Number, roleId: String }]
    }
  },
  {
    id: "moderation",
    name: "Moderation & Logging",
    description: "Mod logs, audit logs, VC logs and mute role.",
    enabled: true,
    settings: {
      modLogChannelId: "",
      auditLogChannelId: "",
      vcLogChannelId: "",
      muteRoleId: ""
    }
  }
];

// Ensure module docs exist for a guild
async function ensureGuildModules(guildId) {
  const existing = await Module.find({ guildId });
  if (existing.length) return existing;

  const docs = DEFAULT_MODULES.map(mod => ({
    guildId,
    id: mod.id,
    name: mod.name,
    description: mod.description,
    enabled: mod.enabled,
    settings: mod.settings
  }));

  await Module.insertMany(docs);
  const created = await Module.find({ guildId });
  console.log(`✅ Seeded modules for guild ${guildId}`);
  return created;
}

// =====================================
// ROUTES — AUTH + USER
// =====================================
app.get("/", (_, res) => res.sendFile(path.join(publicPath, "index.html")));

// Discord OAuth Login
app.get("/auth/discord", (req, res) => {
  const scope = encodeURIComponent("identify guilds");
  const redirect = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(
    DISCORD_REDIRECT_URI
  )}&response_type=code&scope=${scope}`;
  res.redirect(redirect);
});

// Discord OAuth Callback
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

// Verify JWT and return user
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

// =====================================
// GUILDS ENDPOINT — LIST MANAGEABLE GUILDS
// =====================================
app.get("/api/guilds", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Missing token" });

  try {
    const decoded = jwt.verify(auth.split(" ")[1], SESSION_SECRET);
    const access = decoded.access_token;

    // Get user guilds
    const userRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${access}` }
    });
    const userGuilds = await userRes.json();

    // Get bot guilds
    const botRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });
    const botGuilds = await botRes.json();

    const botIds = new Set(Array.isArray(botGuilds) ? botGuilds.map(g => g.id) : []);

    // Filter only manageable guilds (user must have MANAGE_GUILD = 0x20)
    const manageable = userGuilds
      .filter(g => (BigInt(g.permissions || 0n) & 0x20n) === 0x20n)
      .map(g => ({ ...g, installed: botIds.has(g.id) }));

    res.json(manageable);
  } catch (err) {
    console.error("Guild fetch error:", err);
    res.status(401).json({ error: "Invalid or expired token" });
  }
});

// =====================================
// GUILD META — CHANNELS & ROLES
// =====================================
app.get("/api/guilds/:guildId/meta", async (req, res) => {
  const { guildId } = req.params;

  try {
    const [channelsRes, rolesRes] = await Promise.all([
      fetch(`https://discord.com/api/guilds/${guildId}/channels`, {
        headers: { Authorization: `Bot ${BOT_TOKEN}` }
      }),
      fetch(`https://discord.com/api/guilds/${guildId}/roles`, {
        headers: { Authorization: `Bot ${BOT_TOKEN}` }
      })
    ]);

    if (!channelsRes.ok || !rolesRes.ok) {
      console.error("Failed to fetch guild meta:", await channelsRes.text(), await rolesRes.text());
      return res.status(500).json({ error: "Failed to load guild metadata" });
    }

    const channels = await channelsRes.json();
    const roles = await rolesRes.json();

    res.json({
      channels,
      roles
    });
  } catch (err) {
    console.error("Guild meta error:", err);
    res.status(500).json({ error: "Failed to load guild metadata" });
  }
});

// =====================================
// SAFEGUARD MODULES API
// =====================================

// Get all modules for a guild (auto-seed defaults if missing)
app.get("/api/modules/:guildId", async (req, res) => {
  try {
    const { guildId } = req.params;
    const mods = await ensureGuildModules(guildId);
    res.json(mods);
  } catch (err) {
    console.error("Load modules error:", err);
    res.status(500).json({ error: "Failed to load modules" });
  }
});

// Toggle module enable/disable
app.post("/api/modules/toggle/:moduleId", async (req, res) => {
  try {
    const mod = await Module.findById(req.params.moduleId);
    if (!mod) return res.status(404).json({ error: "Module not found" });

    mod.enabled = !mod.enabled;
    await mod.save();

    console.log(`🔧 Module ${mod.id} in guild ${mod.guildId} toggled → ${mod.enabled}`);
    res.json({ success: true, newState: mod.enabled });
  } catch (err) {
    console.error("Toggle module error:", err);
    res.status(500).json({ error: "Failed to toggle module" });
  }
});

// Update module settings
app.post("/api/modules/update/:moduleId", async (req, res) => {
  try {
    const { settings, enabled } = req.body;
    const mod = await Module.findById(req.params.moduleId);
    if (!mod) return res.status(404).json({ error: "Module not found" });

    if (typeof enabled === "boolean") {
      mod.enabled = enabled;
    }
    if (settings && typeof settings === "object") {
      mod.settings = settings;
    }

    await mod.save();
    console.log(`🛠 Settings updated for module ${mod.id} in guild ${mod.guildId}`);
    res.json({ success: true, module: mod });
  } catch (err) {
    console.error("Update module error:", err);
    res.status(500).json({ error: "Failed to update module settings" });
  }
});

// =====================================
// STATIC ROUTES
// =====================================
app.get("/dashboard", (_, res) =>
  res.sendFile(path.join(publicPath, "dashboard.html"))
);

app.get("/dashboard/:id", (_, res) =>
  res.sendFile(path.join(publicPath, "dashboard-guild.html"))
);

// =====================================
// START SERVER
// =====================================
const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL)
  app.listen(PORT, () => console.log("✅ Safeguard panel on port", PORT));

module.exports = app;
