const express = require("express");
const jwt = require("jsonwebtoken");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
const SESSION_SECRET = process.env.SESSION_SECRET || "super-secret-fallback";

const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

// Root
app.get("/", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

// ===== OAUTH LOGIN =====
app.get("/auth/discord", (req, res) => {
  const scope = encodeURIComponent("identify guilds");
  const redirect = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(
    DISCORD_REDIRECT_URI
  )}&response_type=code&scope=${scope}`;
  res.redirect(redirect);
});

// ===== CALLBACK =====
app.get("/auth/discord/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect("/?error=no_code");

  try {
    const params = new URLSearchParams();
    params.append("client_id", DISCORD_CLIENT_ID);
    params.append("client_secret", DISCORD_CLIENT_SECRET);
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", DISCORD_REDIRECT_URI);
    params.append("scope", "identify guilds");

    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      body: params,
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });

    const oauthData = await tokenRes.json();

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
    console.error(err);
    res.redirect("/?error=auth_failed");
  }
});

// ===== USER INFO =====
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

// ===== USER GUILDS =====
app.get("/api/guilds", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Missing token" });

  try {
    const decoded = jwt.verify(auth.split(" ")[1], SESSION_SECRET);
    const access = decoded.access_token;

    const guildsRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${access}` }
    });

    const data = await guildsRes.json();

    // Handle Discord API errors gracefully
    if (!Array.isArray(data)) {
      console.error("Discord returned error:", data);
      return res.status(400).json({ error: "Failed to fetch guilds", details: data });
    }

    // Only guilds the user can manage (permission bit 0x20)
    const manageable = data.filter(g => {
      const perms = BigInt(g.permissions || 0);
      return (perms & BigInt(0x20)) === BigInt(0x20);
    });

    res.json(manageable);
  } catch (err) {
    console.error("Guild fetch error:", err);
    res.status(401).json({ error: "Invalid or expired token" });
  }
});


// ===== DASHBOARD PAGE =====
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(publicPath, "dashboard.html"));
});

const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) app.listen(PORT, () => console.log("Running on", PORT));

module.exports = app;
