const connectDB = require("../../../lib/db");
const WelcomeGuildConfig = require("../../../models/WelcomeGuildConfig");
const GuildConfig = require("../../../models/GuildConfig");
const AuditGuildConfig = require("../../../models/AuditGuildConfig");
const VcGuildConfig = require("../../../models/VcGuildConfig");
const { Settings: LevelSettings } = require("../../../models/LevelSettings");
const TicketGuildConfig = require("../../../models/TicketGuildConfig");
const LockdownSetup = require("../../../models/LockdownSetup");
const ModuleSettings = require("../../../models/ModuleSettings");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();

  const { moduleId } = req.query;
  const { guildId, enabled } = req.body;
  if (!guildId) return res.status(400).json({ error: "guildId missing" });

  await connectDB();

  switch (moduleId) {
    case "welcome":
      const welcome = await WelcomeGuildConfig.findOne({ guildId });
      if (!welcome) return res.status(404).end();
      welcome.welcome.enabled = enabled;
      welcome.goodbye.enabled = enabled;
      await welcome.save();
      break;

    case "verification":
      const verify = await WelcomeGuildConfig.findOne({ guildId });
      verify.verify.enabled = enabled;
      await verify.save();
      break;

    case "logging":
      const log = await GuildConfig.findOne({ guildId });
      if (!enabled) log.modLogChannelId = null;
      await log.save();
      break;

    case "auditlogs":
      const audit = await AuditGuildConfig.findOne({ guildId });
      if (!enabled) audit.modLogChannelId = null;
      await audit.save();
      break;

    case "vclogs":
      const vc = await VcGuildConfig.findOne({ guildId });
      if (!enabled) vc.modLogChannelId = null;
      await vc.save();
      break;

    case "leveling":
      const level = await LevelSettings.findOne({ GuildID: guildId });
      level.XPPerMessage = enabled ? 5 : 0;
      await level.save();
      break;

    case "tickets":
      const ticket = await TicketGuildConfig.findOne({ guildId });
      if (!enabled) {
        ticket.panelChannel = null;
        ticket.supportRole = null;
      }
      await ticket.save();
      break;

    case "lockdown":
      const lockdown = await LockdownSetup.findOne({ guildId });
      if (!enabled) {
        lockdown.channelRoles = [];
        lockdown.serverRoles = [];
      }
      await lockdown.save();
      break;

    case "automod":
    case "antiraid":
      const mod = await ModuleSettings.findOne({ guildId, moduleId });
      mod.enabled = enabled;
      await mod.save();
      break;
  }

  res.json({ ok: true });
};
