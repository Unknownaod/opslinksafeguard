// api/modules/toggle/[moduleId].js
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
  const { guildId, enabled } = req.body || {};

  if (!guildId || typeof enabled !== "boolean") {
    return res
      .status(400)
      .json({ error: "guildId and boolean enabled are required" });
  }

  try {
    await connectDB();

    switch (moduleId) {
      case "welcome": {
        const cfg = await WelcomeGuildConfig.findOne({ guildId });
        if (!cfg) break;
        cfg.welcome.enabled = enabled;
        cfg.goodbye.enabled = enabled;
        await cfg.save();
        break;
      }
      case "verification": {
        const cfg = await WelcomeGuildConfig.findOne({ guildId });
        if (!cfg) break;
        cfg.verify.enabled = enabled;
        await cfg.save();
        break;
      }
      case "logging": {
        const cfg = await GuildConfig.findOne({ guildId });
        if (!cfg) break;
        if (!enabled) cfg.modLogChannelId = null;
        await cfg.save();
        break;
      }
      case "auditlogs": {
        const cfg = await AuditGuildConfig.findOne({ guildId });
        if (!cfg) break;
        if (!enabled) cfg.modLogChannelId = null;
        await cfg.save();
        break;
      }
      case "vclogs": {
        const cfg = await VcGuildConfig.findOne({ guildId });
        if (!cfg) break;
        if (!enabled) cfg.modLogChannelId = null;
        await cfg.save();
        break;
      }
      case "adminrole":
      case "muterole":
      case "botstatus":
        // these are controlled by presence of IDs; toggle alone doesn't change anything
        break;

      case "lockdown": {
        const cfg = await LockdownSetup.findOne({ guildId });
        if (!cfg) break;
        if (!enabled) {
          cfg.channelRoles = [];
          cfg.serverRoles = [];
        }
        await cfg.save();
        break;
      }
      case "leveling": {
        const cfg = await LevelSettings.findOne({ GuildID: guildId });
        if (!cfg) break;
        cfg.XPPerMessage = enabled ? cfg.XPPerMessage || 5 : 0;
        await cfg.save();
        break;
      }
      case "sticky": {
        const cfg = await Sticky.findOne({ guildId });
        if (!cfg) break;
        if (!enabled) {
          cfg.stickies = [];
        }
        await cfg.save();
        break;
      }
      case "punishments": {
        const cfg = await PunishmentConfig.findOne({ guildId });
        if (!cfg) break;
        if (!enabled) cfg.rules = [];
        await cfg.save();
        break;
      }

      case "tickets": {
        const cfg = await TicketGuildConfig.findOne({ guildId });
        if (!cfg) break;
        if (!enabled) {
          cfg.panelChannel = null;
          cfg.supportRole = null;
          cfg.ticketCategory = null;
        }
        await cfg.save();
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
        cfg.enabled = enabled;
        await cfg.save();
        break;
      }

      default:
        return res.status(404).json({ error: "Unknown moduleId" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/modules/toggle error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
