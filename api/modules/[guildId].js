// api/modules/[guildId].js
const connectDB = require("../../lib/db");

// CONFIG MODELS
const WelcomeGuildConfig = require("../../models/WelcomeGuildConfig");
const GuildConfig = require("../../models/GuildConfig");
const AuditGuildConfig = require("../../models/AuditGuildConfig");
const VcGuildConfig = require("../../models/VcGuildConfig");
const MuteRole = require("../../models/MuteRole");
const { Settings: LevelSettings } = require("../../models/LevelSettings");
const TicketGuildConfig = require("../../models/TicketGuildConfig");
const LockdownSetup = require("../../models/LockdownSetup");
const ModuleSettings = require("../../models/ModuleSettings");
const AdminRole = require("../../models/AdminRole");
const BotStatusChannel = require("../../models/BotStatusChannel");
const PunishmentConfig = require("../../models/PunishmentConfig");
const Sticky = require("../../models/Sticky");

module.exports = async (req, res) => {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method Not Allowed" });

  // ✅ Use params for /api/modules/:guildId routes
  const guildId = req.params?.guildId || req.query?.guildId;
  if (!guildId)
    return res.status(400).json({ error: "Missing guildId parameter" });

  try {
    await connectDB();

    console.log(`[Modules] Fetching configuration for guild ${guildId}`);

    // Helper to ensure document exists
    const ensure = async (Model, query, defaults = {}) => {
      const existing = await Model.findOne(query);
      if (existing) return existing;
      return await Model.create({ ...query, ...defaults });
    };

    // =============== FETCH/CREATE CONFIGS ===============
    const welcomeCfg = await ensure(WelcomeGuildConfig, { guildId });
    const guildCfg = await ensure(GuildConfig, { guildId });
    const auditCfg = await ensure(AuditGuildConfig, { guildId });
    const vcCfg = await ensure(VcGuildConfig, { guildId });
    const levelCfg = await ensure(LevelSettings, { GuildID: guildId });
    const ticketCfg = await ensure(TicketGuildConfig, { guildId });
    const lockdownCfg = await ensure(LockdownSetup, { guildId });

    const muteRole = await MuteRole.findOne({ guildId });
    const adminRole = await AdminRole.findOne({ guildId });
    const botStatus = await BotStatusChannel.findOne({ guildId });
    const punishCfg =
      (await PunishmentConfig.findOne({ guildId })) ||
      (await PunishmentConfig.create({ guildId, rules: [] }));
    const stickyCfg =
      (await Sticky.findOne({ guildId })) ||
      (await Sticky.create({ guildId, roleIds: [], stickies: [] }));

    const automodCfg = await ensure(ModuleSettings, {
      guildId,
      moduleId: "automod",
    });
    const antiraidCfg = await ensure(ModuleSettings, {
      guildId,
      moduleId: "antiraid",
    });
    const announceCfg = await ensure(ModuleSettings, {
      guildId,
      moduleId: "announcements",
    });
    const giveawayCfg = await ensure(ModuleSettings, {
      guildId,
      moduleId: "giveaways",
    });
    const pollCfg = await ensure(ModuleSettings, {
      guildId,
      moduleId: "polls",
    });

    // =============== MODULE DEFINITIONS ===============
    const modules = [
      {
        id: "welcome",
        name: "Welcome & Goodbye",
        group: "General",
        enabled: !!(
          welcomeCfg.welcome?.enabled || welcomeCfg.goodbye?.enabled
        ),
        description:
          "Welcome/goodbye messages, join DMs, backgrounds and autoroles.",
        settings: {
          welcomeChannelId: welcomeCfg.welcome?.channel || "",
          welcomeMessage: welcomeCfg.welcome?.message || "",
          welcomeDm: welcomeCfg.welcome?.joindm || "",
          goodbyeChannelId: welcomeCfg.goodbye?.channel || "",
          goodbyeMessage: welcomeCfg.goodbye?.message || "",
          goodbyeDm: welcomeCfg.goodbye?.leavedm || "",
          autoroles: (welcomeCfg.autoroles || []).join(","),
          autoroleDelayMs: welcomeCfg.autoroleDelay ?? 0,
        },
      },
      {
        id: "verification",
        name: "Verification",
        group: "General",
        enabled: !!welcomeCfg.verify?.enabled,
        description:
          "Captcha verification, roles, logging and difficulty controls.",
        settings: {
          panelChannelId: welcomeCfg.verify?.channel || "",
          logChannelId: welcomeCfg.verify?.logChannel || "",
          roles: (welcomeCfg.verify?.roles || []).join(","),
          staffRoleId: welcomeCfg.verify?.staffRole || "",
          message:
            welcomeCfg.verify?.message ||
            "Click Verify to prove you're human.",
          difficultyMode: welcomeCfg.verify?.difficulty?.mode || "medium",
          difficultyLength: welcomeCfg.verify?.difficulty?.length ?? 5,
          difficultyDecoys: welcomeCfg.verify?.difficulty?.decoys ?? 10,
          difficultyTrace: String(
            welcomeCfg.verify?.difficulty?.trace ?? true
          ),
        },
      },
      {
        id: "logging",
        name: "Moderation Logs",
        group: "General",
        enabled: !!guildCfg.modLogChannelId,
        description: "Warn, kick, ban and moderation log channel.",
        settings: { modLogChannelId: guildCfg.modLogChannelId || "" },
      },
      {
        id: "auditlogs",
        name: "Audit Logs",
        group: "General",
        enabled: !!auditCfg.modLogChannelId,
        description:
          "Configuration changes and join/leave logging channel for the guild.",
        settings: { auditLogChannelId: auditCfg.modLogChannelId || "" },
      },
      {
        id: "vclogs",
        name: "Voice Logs",
        group: "General",
        enabled: !!vcCfg.modLogChannelId,
        description: "Track joins, leaves and moves between voice channels.",
        settings: { vcLogChannelId: vcCfg.modLogChannelId || "" },
      },
      {
        id: "adminrole",
        name: "Admin Role",
        group: "General",
        enabled: !!adminRole?.roleId,
        description:
          "Designated SafeGuard admin role for the dashboard/bot.",
        settings: { adminRoleId: adminRole?.roleId || "" },
      },
      {
        id: "muterole",
        name: "Mute Role",
        group: "General",
        enabled: !!muteRole?.roleId,
        description: "Global mute role used by moderation commands.",
        settings: { muteRoleId: muteRole?.roleId || "" },
      },
      {
        id: "lockdown",
        name: "Lockdown",
        group: "General",
        enabled:
          (lockdownCfg.channelRoles?.length || 0) > 0 ||
          (lockdownCfg.serverRoles?.length || 0) > 0,
        description:
          "Control which roles keep permissions during lockdown.",
        settings: {
          channelRoles: (lockdownCfg.channelRoles || []).join(","),
          serverRoles: (lockdownCfg.serverRoles || []).join(","),
        },
      },
      {
        id: "botstatus",
        name: "Bot Status Channel",
        group: "General",
        enabled: !!botStatus?.channelId,
        description:
          "Channel where SafeGuard posts its live status/uptime message.",
        settings: { statusChannelId: botStatus?.channelId || "" },
      },
      {
        id: "antiraid",
        name: "Anti-Raid",
        group: "Protection",
        enabled: !!antiraidCfg.enabled,
        description: "Detect and respond to raid-level join spikes.",
        settings: {
          joinThreshold: antiraidCfg.settings?.joinThreshold ?? 8,
          timeWindowSec: antiraidCfg.settings?.timeWindowSec ?? 30,
          autoLockdown:
            String(antiraidCfg.settings?.autoLockdown ?? "true") || "true",
        },
      },
      {
        id: "automod",
        name: "AutoMod",
        group: "Protection",
        enabled: !!automodCfg.enabled,
        description:
          "Anti-link, anti-invite and word filters for your community.",
        settings: {
          blockLinks: String(automodCfg.settings?.blockLinks ?? "false"),
          blockInvites: String(automodCfg.settings?.blockInvites ?? "false"),
          blacklistedWords: automodCfg.settings?.blacklistedWords || "",
        },
      },
      {
        id: "punishments",
        name: "Punishment Automation",
        group: "Protection",
        enabled: (punishCfg.rules || []).length > 0,
        description:
          "Automatically timeout, kick or ban at specific warning counts.",
        settings: {
          rules:
            (punishCfg.rules || [])
              .map(
                (r) =>
                  `${r.warningCount}:${r.action}:${
                    r.duration != null ? r.duration : ""
                  }`
              )
              .join("\n") || "",
        },
      },
      {
        id: "leveling",
        name: "XP & Leveling",
        group: "Engagement",
        enabled: (levelCfg.XPPerMessage ?? 0) > 0,
        description: "XP per message, level-up channel and role rewards.",
        settings: {
          xpPerMessage: levelCfg.XPPerMessage ?? 5,
          levelUpChannelId: levelCfg.LevelChannel || "",
          roleRewards:
            (levelCfg.Roles || [])
              .map((r) => `${r.Level}:${r.RoleID}`)
              .join("\n") || "",
        },
      },
      {
        id: "sticky",
        name: "Sticky Messages",
        group: "Engagement",
        enabled: (stickyCfg.stickies || []).length > 0,
        description:
          "Auto-restick messages in specific channels to keep info visible.",
        settings: {
          staffRoleIds: (stickyCfg.roleIds || []).join(","),
          defaultIntervalMs:
            stickyCfg.stickies?.[0]?.interval != null
              ? stickyCfg.stickies[0].interval
              : 60000,
        },
      },
      {
        id: "announcements",
        name: "Announcements",
        group: "Engagement",
        enabled: !!announceCfg.enabled,
        description:
          "Default channel and roles for automated announcement helpers.",
        settings: {
          defaultChannelId: announceCfg.settings?.defaultChannelId || "",
          pingRoles: announceCfg.settings?.pingRoles || "",
        },
      },
      {
        id: "giveaways",
        name: "Giveaways",
        group: "Engagement",
        enabled: !!giveawayCfg.enabled,
        description:
          "Control whether the giveaway system is active and its defaults.",
        settings: {
          defaultChannelId: giveawayCfg.settings?.defaultChannelId || "",
          defaultDurationMinutes:
            giveawayCfg.settings?.defaultDurationMinutes ?? 60,
          defaultWinners: giveawayCfg.settings?.defaultWinners ?? 1,
        },
      },
      {
        id: "polls",
        name: "Polls",
        group: "Engagement",
        enabled: !!pollCfg.enabled,
        description: "Quick poll system for engagement and feedback.",
        settings: {
          defaultChannelId: pollCfg.settings?.defaultChannelId || "",
          requireRoleIds: pollCfg.settings?.requireRoleIds || "",
        },
      },
      {
        id: "tickets",
        name: "Tickets",
        group: "Engagement",
        enabled:
          !!ticketCfg.panelChannel ||
          !!ticketCfg.supportRole ||
          !!ticketCfg.ticketCategory,
        description:
          "Support ticket panels, support/team roles and ticket categories.",
        settings: {
          panelChannel: ticketCfg.panelChannel || "",
          supportRole: ticketCfg.supportRole || "",
          ticketCategory: ticketCfg.ticketCategory || "",
        },
      },
    ];

    // ✅ Success response
    res.status(200).json(modules);
  } catch (err) {
    console.error("❌ GET /api/modules/:guildId error:", err);
    res.status(500).json({ error: "Internal Server Error", details: err.message });
  }
};
