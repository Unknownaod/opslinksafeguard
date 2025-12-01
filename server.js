const express = require("express");
const jwt = require("jsonwebtoken");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config();

const app = express();
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

const {
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  DISCORD_REDIRECT_URI,
  SESSION_SECRET,
  BOT_TOKEN
} = process.env;

/* ========= Root ========= */
app.get("/", (_, res) => res.sendFile(path.join(publicPath, "index.html")));

/* ========= Discord OAuth Login ========= */
app.get("/auth/discord", (req, res) => {
  const scope = encodeURIComponent("identify guilds");
  const redirect = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(
    DISCORD_REDIRECT_URI
  )}&response_type=code&scope=${scope}`;
  res.redirect(redirect);
});

/* ========= Callback ========= */
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

/* ========= API: user info ========= */
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

/* ========= API: guild list ========= */
app.get("/api/guilds", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Missing token" });
  try {
    const decoded = jwt.verify(auth.split(" ")[1], SESSION_SECRET);
    const access = decoded.access_token;

    // user guilds
    const userRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${access}` }
    });
    const userGuilds = await userRes.json();
    if (!Array.isArray(userGuilds))
      return res.status(400).json({ error: "Discord returned invalid data", details: userGuilds });

    // bot guilds
    const botRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });
    const botGuilds = await botRes.json();
    const botIds = new Set(Array.isArray(botGuilds) ? botGuilds.map(g => g.id) : []);

    // manageable + installed flag
    const manageable = userGuilds
      .filter(g => (BigInt(g.permissions || 0n) & 0x20n) === 0x20n)
      .map(g => ({ ...g, installed: botIds.has(g.id) }));

    res.json(manageable);
  } catch (err) {
    console.error("Guild fetch error:", err);
    res.status(401).json({ error: "Invalid or expired token" });
  }
});

/* ========= Static dashboard routes ========= */
app.get("/dashboard", (_, res) => res.sendFile(path.join(publicPath, "dashboard.html")));
app.get("/dashboard/:id", (_, res) => res.sendFile(path.join(publicPath, "dashboard-guild.html")));

/* ========= Local dev ========= */
const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) app.listen(PORT, () => console.log("Safeguard panel running on port", PORT));

module.exports = app;
