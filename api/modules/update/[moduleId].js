// api/modules/update/[moduleId].js
const connectDB = require("../../../lib/db");
const WelcomeGuildConfig = require("../../../models/WelcomeGuildConfig");
const GuildConfig = require("../../../models/GuildConfig");
const AuditGuildConfig = require("../../../models/AuditGuildConfig");
const VcGuildConfig = require("../../../models/VcGuildConfig");
const { Settings: LevelSettings } = require("../../../models/LevelSettings");
const TicketGuildConfig = require("../../../models/TicketGuildConfig");
const LockdownSetup = require("../../../models/LockdownSetup");
const ModuleSettings = require("../../../models/ModuleSettings");
const AdminRole = require("../../../models/AdminRole");
const MuteRole = require("../../../models/MuteRole");
const BotStatusChannel = require("../../../models/BotStatusChannel");
const PunishmentConfig = require("../../../models/PunishmentConfig");
const Sticky = require("../../../models/Sticky");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();

  const { moduleId } = req.query;
  const { guildId, settings } = req.body || {};

  if (!guildId || !settings) {
    return res
      .status(400)
      .json({ error: "guildId and settings are required" });
  }

  try {
    await connectDB();

    let savedSettings = settings;

    switch (moduleId) {
      case "welcome": {
        const cfg =
          (await WelcomeGuildConfig.findOne({ guildId })) ||
          (await WelcomeGuildConfig.create({ guildId }));

        cfg.welcome = cfg.welcome || {};
        cfg.goodbye = cfg.goodbye || {};

        cfg.welcome.channel = settings.welcomeChannelId || null;
        cfg.welcome.message = settings.welcomeMessage || null;
        cfg.welcome.joindm = settings.welcomeDm || null;

        cfg.goodbye.channel = settings.goodbyeChannelId || null;
        cfg.goodbye.message = settings.goodbyeMessage || null;
        cfg.goodbye.leavedm = settings.goodbyeDm || null;

        cfg.autoroles = (settings.autoroles || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        cfg.autoroleDelay = Number(settings.autoroleDelayMs) || 0;

        await cfg.save();

        savedSettings = {
          welcomeChannelId: cfg.welcome.channel || "",
          welcomeMessage: cfg.welcome.message || "",
          welcomeDm: cfg.welcome.joindm || "",
          goodbyeChannelId: cfg.goodbye.channel || "",
          goodbyeMessage: cfg.goodbye.message || "",
          goodbyeDm: cfg.goodbye.leavedm || "",
          autoroles: (cfg.autoroles || []).join(","),
          autoroleDelayMs: cfg.autoroleDelay,
        };
        break;
      }

      case "verification": {
        const cfg =
          (await WelcomeGuildConfig.findOne({ guildId })) ||
          (await WelcomeGuildConfig.create({ guildId }));

        cfg.verify = cfg.verify || {};
        cfg.verify.channel = settings.panelChannelId || null;
        cfg.verify.logChannel = settings.logChannelId || null;
        cfg.verify.roles = (settings.roles || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        cfg.verify.staffRole = settings.staffRoleId || null;
        cfg.verify.message =
          settings.message ||
          cfg.verify.message ||
          "Click Verify to prove you're human.";

        cfg.verify.difficulty = cfg.verify.difficulty || {};
        if (settings.difficultyMode)
          cfg.verify.difficulty.mode = settings.difficultyMode;
        if (settings.difficultyLength !== undefined) {
          const v = Number(settings.difficultyLength);
          if (!Number.isNaN(v)) cfg.verify.difficulty.length = v;
        }
        if (settings.difficultyDecoys !== undefined) {
          const v = Number(settings.difficultyDecoys);
          if (!Number.isNaN(v)) cfg.verify.difficulty.decoys = v;
        }
        if (settings.difficultyTrace !== undefined) {
          const val = String(settings.difficultyTrace).toLowerCase();
          cfg.verify.difficulty.trace =
            val === "true" || val === "1" || val === "yes";
        }

        await cfg.save();

        const v = cfg.verify;
        savedSettings = {
          panelChannelId: v.channel || "",
          logChannelId: v.logChannel || "",
          roles: (v.roles || []).join(","),
          staffRoleId: v.staffRole || "",
          message: v.message || "",
          difficultyMode: v.difficulty?.mode || "medium",
          difficultyLength: v.difficulty?.length ?? 5,
          difficultyDecoys: v.difficulty?.decoys ?? 10,
          difficultyTrace: String(v.difficulty?.trace ?? true),
        };
        break;
      }

      case "logging": {
        const cfg =
          (await GuildConfig.findOne({ guildId })) ||
          (await GuildConfig.create({ guildId }));
        cfg.modLogChannelId = settings.modLogChannelId || null;
        await cfg.save();
        savedSettings = { modLogChannelId: cfg.modLogChannelId || "" };
        break;
      }

      case "auditlogs": {
        const cfg =
          (await AuditGuildConfig.findOne({ guildId })) ||
          (await AuditGuildConfig.create({ guildId }));
        cfg.modLogChannelId = settings.auditLogChannelId || null;
        await cfg.save();
        savedSettings = { auditLogChannelId: cfg.modLogChannelId || "" };
        break;
      }

      case "vclogs": {
        const cfg =
          (await VcGuildConfig.findOne({ guildId })) ||
          (await VcGuildConfig.create({ guildId }));
        cfg.modLogChannelId = settings.vcLogChannelId || null;
        await cfg.save();
        savedSettings = { vcLogChannelId: cfg.modLogChannelId || "" };
        break;
      }

      case "adminrole": {
        let cfg = await AdminRole.findOne({ guildId });
        if (!settings.adminRoleId) {
          if (cfg) await cfg.deleteOne();
        } else {
          if (!cfg) {
            cfg = await AdminRole.create({
              guildId,
              roleId: settings.adminRoleId,
            });
          } else {
            cfg.roleId = settings.adminRoleId;
            await cfg.save();
          }
        }
        savedSettings = { adminRoleId: settings.adminRoleId || "" };
        break;
      }

      case "muterole": {
        let cfg = await MuteRole.findOne({ guildId });
        if (!settings.muteRoleId) {
          if (cfg) await cfg.deleteOne();
        } else {
          if (!cfg) {
            cfg = await MuteRole.create({
              guildId,
              roleId: settings.muteRoleId,
            });
          } else {
            cfg.roleId = settings.muteRoleId;
            await cfg.save();
          }
        }
        savedSettings = { muteRoleId: settings.muteRoleId || "" };
        break;
      }

      case "lockdown": {
        const cfg =
          (await LockdownSetup.findOne({ guildId })) ||
          (await LockdownSetup.create({ guildId }));
        cfg.channelRoles = (settings.channelRoles || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        cfg.serverRoles = (settings.serverRoles || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        await cfg.save();
        savedSettings = {
          channelRoles: cfg.channelRoles.join(","),
          serverRoles: cfg.serverRoles.join(","),
        };
        break;
      }

      case "botstatus": {
        let cfg =
          (await BotStatusChannel.findOne({ guildId })) ||
          (await BotStatusChannel.create({
            guildId,
            channelId: null,
            messageId: null,
          }));
        cfg.channelId = settings.statusChannelId || null;
        await cfg.save();
        savedSettings = { statusChannelId: cfg.channelId || "" };
        break;
      }

      case "leveling": {
        const cfg =
          (await LevelSettings.findOne({ GuildID: guildId })) ||
          (await LevelSettings.create({ GuildID: guildId }));
        cfg.XPPerMessage = Number(settings.xpPerMessage || 0);
        cfg.LevelChannel = settings.levelUpChannelId || null;

        const lines = (settings.roleRewards || "")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);

        cfg.Roles = lines
          .map((line) => {
            const [lvl, roleId] = line.split(":").map((p) => p.trim());
            const n = Number(lvl);
            if (!lvl || !roleId || Number.isNaN(n)) return null;
            return { Level: n, RoleID: roleId };
          })
          .filter(Boolean);

        await cfg.save();

        savedSettings = {
          xpPerMessage: cfg.XPPerMessage,
          levelUpChannelId: cfg.LevelChannel || "",
          roleRewards:
            (cfg.Roles || [])
              .map((r) => `${r.Level}:${r.RoleID}`)
              .join("\n") || "",
        };
        break;
      }

      case "sticky": {
        const cfg =
          (await Sticky.findOne({ guildId })) ||
          (await Sticky.create({ guildId, roleIds: [], stickies: [] }));
        cfg.roleIds = (settings.staffRoleIds || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        const interval = Number(settings.defaultIntervalMs || 60000);
        if (!Number.isNaN(interval)) {
          cfg.stickies = (cfg.stickies || []).map((s) => ({
            ...s.toObject?.() || s,
            interval,
          }));
        }

        await cfg.save();
        savedSettings = {
          staffRoleIds: cfg.roleIds.join(","),
          defaultIntervalMs:
            cfg.stickies?.[0]?.interval != null
              ? cfg.stickies[0].interval
              : interval,
        };
        break;
      }

      case "punishments": {
        const cfg =
          (await PunishmentConfig.findOne({ guildId })) ||
          (await PunishmentConfig.create({ guildId, rules: [] }));

        const lines = (settings.rules || "")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);

        cfg.rules = lines
          .map((line) => {
            const [warnings, action, duration] = line
              .split(":")
              .map((p) => p.trim());
            const w = Number(warnings);
            if (!warnings || !action || Number.isNaN(w)) return null;
            const d =
              duration && duration.length
                ? Number(duration)
                : null;
            return {
              warningCount: w,
              action,
              duration: d,
            };
          })
          .filter(Boolean);

        await cfg.save();

        savedSettings = {
          rules:
            (cfg.rules || [])
              .map((r) =>
                [
                  r.warningCount,
                  r.action,
                  r.duration != null ? r.duration : "",
                ].join(":")
              )
              .join("\n") || "",
        };
        break;
      }

      case "tickets": {
        const cfg =
          (await TicketGuildConfig.findOne({ guildId })) ||
          (await TicketGuildConfig.create({ guildId }));
        cfg.panelChannel = settings.panelChannel || null;
        cfg.supportRole = settings.supportRole || null;
        cfg.ticketCategory = settings.ticketCategory || null;
        await cfg.save();
        savedSettings = {
          panelChannel: cfg.panelChannel || "",
          supportRole: cfg.supportRole || "",
          ticketCategory: cfg.ticketCategory || "",
        };
        break;
      }

      // ModuleSettings-based modules
      case "antiraid":
      case "automod":
      case "announcements":
      case "giveaways":
      case "polls": {
        const cfg =
          (await ModuleSettings.findOne({ guildId, moduleId })) ||
          (await ModuleSettings.create({ guildId, moduleId }));
        cfg.settings = settings;
        await cfg.save();
        savedSettings = cfg.settings;
        break;
      }

      default:
        return res.status(404).json({ error: "Unknown moduleId" });
    }

    res.json({ ok: true, settings: savedSettings });
  } catch (err) {
    console.error("POST /api/modules/update error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
