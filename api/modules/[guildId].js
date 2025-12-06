const connectDB = require("../../lib/db");

const WelcomeGuildConfig = require("../../models/WelcomeGuildConfig");
const GuildConfig = require("../../models/GuildConfig");
const AuditGuildConfig = require("../../models/AuditGuildConfig");
const VcGuildConfig = require("../../models/VcGuildConfig");
const MuteRole = require("../../models/MuteRole");
const { Settings: LevelSettings } = require("../../models/LevelSettings");
const TicketGuildConfig = require("../../models/TicketGuildConfig");
const LockdownSetup = require("../../models/LockdownSetup");
const ModuleSettings = require("../../models/ModuleSettings");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const { guildId } = req.query;
  if (!guildId) return res.status(400).json({ error: "Missing guildId" });

  await connectDB();

  const ensure = async (Model, data) =>
    (await Model.findOne(data)) || (await Model.create(data));

  const welcome = await ensure(WelcomeGuildConfig, { guildId });
  const audit = await ensure(AuditGuildConfig, { guildId });
  const guild = await ensure(GuildConfig, { guildId });
  const vc = await ensure(VcGuildConfig, { guildId });
  const level = await ensure(LevelSettings, { GuildID: guildId });
  const tickets = await ensure(TicketGuildConfig, { guildId });
  const lockdown = await ensure(LockdownSetup, { guildId });
  const automod = await ensure(ModuleSettings, { guildId, moduleId: "automod" });
  const antiraid = await ensure(ModuleSettings, { guildId, moduleId: "antiraid" });

  const modules = [
    {
      id: "welcome",
      name: "Welcome & Goodbye",
      enabled: welcome.welcome?.enabled || welcome.goodbye?.enabled,
      description: "Send join/leave messages, DMs, and autoroles.",
      settings: {
        welcomeChannelId: welcome.welcome?.channel || "",
        welcomeMessage: welcome.welcome?.message || "",
        goodbyeChannelId: welcome.goodbye?.channel || "",
        goodbyeMessage: welcome.goodbye?.message || "",
      },
    },
    {
      id: "verification",
      name: "Verification",
      enabled: welcome.verify?.enabled,
      description: "Captcha verification and role granting.",
      settings: {
        channel: welcome.verify?.channel || "",
        staffRole: welcome.verify?.staffRole || "",
      },
    },
    {
      id: "logging",
      name: "Moderation Logs",
      enabled: !!guild.modLogChannelId,
      description: "Record moderation actions (bans, kicks, etc).",
      settings: { modLogChannelId: guild.modLogChannelId || "" },
    },
    {
      id: "auditlogs",
      name: "Audit Logs",
      enabled: !!audit.modLogChannelId,
      description: "Tracks configuration and join/leave events.",
      settings: { auditLogChannelId: audit.modLogChannelId || "" },
    },
    {
      id: "vclogs",
      name: "VC Logs",
      enabled: !!vc.modLogChannelId,
      description: "Logs voice join/leave/move events.",
      settings: { vcLogChannelId: vc.modLogChannelId || "" },
    },
    {
      id: "leveling",
      name: "XP & Levels",
      enabled: level.XPPerMessage > 0,
      description: "XP per message, level-up rewards.",
      settings: {
        xpPerMessage: level.XPPerMessage,
        levelUpChannelId: level.LevelChannel || "",
      },
    },
    {
      id: "tickets",
      name: "Tickets",
      enabled:
        tickets.panelChannel || tickets.supportRole || tickets.ticketCategory,
      description: "Support ticket system configuration.",
      settings: {
        panelChannel: tickets.panelChannel || "",
        supportRole: tickets.supportRole || "",
      },
    },
    {
      id: "lockdown",
      name: "Lockdown",
      enabled:
        (lockdown.channelRoles?.length || lockdown.serverRoles?.length) > 0,
      description: "Control who can chat during lockdowns.",
      settings: {
        channelRoles: lockdown.channelRoles?.join(",") || "",
        serverRoles: lockdown.serverRoles?.join(",") || "",
      },
    },
    {
      id: "automod",
      name: "AutoMod",
      enabled: automod.enabled,
      description: "Link and word filtering.",
      settings: automod.settings || { blockLinks: "false", words: "" },
    },
    {
      id: "antiraid",
      name: "Anti-Raid",
      enabled: antiraid.enabled,
      description: "Detect and mitigate mass joins.",
      settings: antiraid.settings || { joinThreshold: 8, timeWindowSec: 30 },
    },
  ];

  res.json(modules);
};
