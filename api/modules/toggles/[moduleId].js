// api/modules/toggle/[moduleId].js
const connectDB = require("../../../lib/db");

// Models
const WelcomeGuildConfig = require("../../../models/WelcomeGuildConfig");
const GuildConfig = require("../../../models/GuildConfig");
const AuditGuildConfig = require("../../../models/AuditGuildConfig");
const VcGuildConfig = require("../../../models/VcGuildConfig");
const { Settings: LevelSettings } = require("../../../models/LevelSettings");
const TicketGuildConfig = require("../../../models/TicketGuildConfig");
const LockdownSetup = require("../../../models/LockdownSetup");
const ModuleSettings = require("../../../models/ModuleSettings");
const AdminRole = require("../../../models/adminRole");
const MuteRole = require("../../../models/muteRole");
const BotStatusChannel = require("../../../models/BotStatusChannel");
const PunishmentConfig = require("../../../models/PunishmentConfig");
const Sticky = require("../../../models/Sticky");

async function getOrCreate(model, query, defaults = {}) {
  let doc = await model.findOne(query);
  if (!doc) doc = await model.create({ ...query, ...defaults });
  return doc;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();

  const { moduleId } = req.query;
  const { guildId, enabled } = req.body || {};

  if (!guildId || typeof enabled !== "boolean")
    return res.status(400).json({ error: "guildId and boolean enabled required" });

  try {
    await connectDB();

    switch (moduleId) {
      case "welcome": {
        const cfg = await getOrCreate(WelcomeGuildConfig, { guildId });
        cfg.welcome.enabled = enabled;
        cfg.goodbye.enabled = enabled;
        cfg.markModified("welcome");
        cfg.markModified("goodbye");
        await cfg.save();
        break;
      }

      case "verification": {
        const cfg = await getOrCreate(WelcomeGuildConfig, { guildId });
        cfg.verify.enabled = enabled;
        cfg.markModified("verify");
        await cfg.save();
        break;
      }

      case "logging": {
        const cfg = await getOrCreate(GuildConfig, { guildId });
        if (!enabled) cfg.modLogChannelId = null;
        await cfg.save();
        break;
      }

      case "auditlogs": {
        const cfg = await getOrCreate(AuditGuildConfig, { guildId });
        if (!enabled) cfg.modLogChannelId = null;
        await cfg.save();
        break;
      }

      case "vclogs": {
        const cfg = await getOrCreate(VcGuildConfig, { guildId });
        if (!enabled) cfg.modLogChannelId = null;
        await cfg.save();
        break;
      }

      case "adminrole": {
        const cfg = await getOrCreate(AdminRole, { guildId });
        if (!enabled) cfg.roleId = null;
        await cfg.save();
        break;
      }

      case "muterole": {
        const cfg = await getOrCreate(MuteRole, { guildId });
        if (!enabled) cfg.roleId = null;
        await cfg.save();
        break;
      }

      case "botstatus": {
        const cfg = await getOrCreate(BotStatusChannel, { guildId });
        if (!enabled) {
          cfg.channelId = null;
          cfg.messageId = null;
        }
        await cfg.save();
        break;
      }

      case "lockdown": {
        const cfg = await getOrCreate(LockdownSetup, { guildId });
        if (!enabled) {
          cfg.channelRoles = [];
          cfg.serverRoles = [];
        }
        await cfg.save();
        break;
      }

      case "leveling": {
        const cfg = await getOrCreate(LevelSettings, { GuildID: guildId });
        cfg.XPPerMessage = enabled ? cfg.XPPerMessage || 5 : 0;
        await cfg.save();
        break;
      }

      case "sticky": {
        const cfg = await getOrCreate(Sticky, { guildId });
        if (!enabled) cfg.stickies = [];
        await cfg.save();
        break;
      }

      case "punishments": {
        const cfg = await getOrCreate(PunishmentConfig, { guildId });
        if (!enabled) cfg.rules = [];
        await cfg.save();
        break;
      }

      case "tickets": {
        const cfg = await getOrCreate(TicketGuildConfig, { guildId });
        if (!enabled) {
          cfg.panelChannel = null;
          cfg.supportRole = null;
          cfg.ticketCategory = null;
        }
        await cfg.save();
        break;
      }

      case "antiraid":
      case "automod":
      case "announcements":
      case "giveaways":
      case "polls": {
        const cfg = await getOrCreate(ModuleSettings, { guildId, moduleId });
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
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
};
