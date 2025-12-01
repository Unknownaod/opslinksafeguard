const express = require("express");
const jwt = require("jsonwebtoken");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

// ===== ENV VARS (set these in Vercel) =====
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI; // e.g. https://safeguard.opslinkcad.com/auth/discord/callback
const SESSION_SECRET = process.env.SESSION_SECRET || "super-secret-fallback";

// ===== STATIC FILES =====
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

// Root -> serve index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

// ===== DISCORD OAUTH: STEP 1 — redirect to Discord =====
app.get("/auth/discord", (req, res) => {
  const scope = encodeURIComponent("identify guilds");
  const redirect = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(
    DISCORD_REDIRECT_URI
  )}&response_type=code&scope=${scope}`;
  res.redirect(redirect);
});

// ===== DISCORD OAUTH: STEP 2 — handle callback =====
app.get("/auth/discord/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.redirect("/?error=no_code");
  }

  try {
    // Exchange code for access token
    const params = new URLSearchParams();
    params.append("client_id", DISCORD_CLIENT_ID);
    params.append("client_secret", DISCORD_CLIENT_SECRET);
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", DISCORD_REDIRECT_URI);
    params.append("scope", "identify guilds");

    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      body: params,
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });

    const oauthData = await tokenResponse.json();
    if (oauthData.error) {
      console.error("OAuth error:", oauthData);
      return res.redirect("/?error=oauth_failed");
    }

    // Get user info
    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${oauthData.access_token}` }
    });

    const user = await userResponse.json();

    // Sign JWT with user data
    const token = jwt.sign({ user }, SESSION_SECRET, { expiresIn: "1h" });

    // Redirect back to main page with token in query
    res.redirect("/?token=" + encodeURIComponent(token));
  } catch (err) {
    console.error("Discord callback error:", err);
    res.redirect("/?error=server_error");
  }
});

// ===== API: Get current user from JWT =====
app.get("/api/user", (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.json({ loggedIn: false });

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return res.json({ loggedIn: false });
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, SESSION_SECRET);
    return res.json({ loggedIn: true, user: decoded.user });
  } catch (err) {
    return res.json({ loggedIn: false });
  }
});

// Optional logout endpoint (client clears token anyway)
app.get("/logout", (req, res) => {
  res.redirect("/");
});

// ===== LOCAL DEV ONLY =====
const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log("Safeguard panel running on http://localhost:" + PORT);
  });
}

// For Vercel serverless
module.exports = app;
