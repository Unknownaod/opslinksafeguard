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
  const { guildId, settings } = req.body;
  await connectDB();

  switch (moduleId) {
    case "welcome":
      const welcome = await WelcomeGuildConfig.findOne({ guildId });
      welcome.welcome.channel = settings.welcomeChannelId || null;
      welcome.welcome.message = settings.welcomeMessage || null;
      welcome.goodbye.channel = settings.goodbyeChannelId || null;
      welcome.goodbye.message = settings.goodbyeMessage || null;
      await welcome.save();
      break;

    case "verification":
      const verify = await WelcomeGuildConfig.findOne({ guildId });
      verify.verify.channel = settings.channel || null;
      verify.verify.staffRole = settings.staffRole || null;
      await verify.save();
      break;

    case "logging":
      const log = await GuildConfig.findOne({ guildId });
      log.modLogChannelId = settings.modLogChannelId || null;
      await log.save();
      break;

    case "auditlogs":
      const audit = await AuditGuildConfig.findOne({ guildId });
      audit.modLogChannelId = settings.auditLogChannelId || null;
      await audit.save();
      break;

    case "vclogs":
      const vc = await VcGuildConfig.findOne({ guildId });
      vc.modLogChannelId = settings.vcLogChannelId || null;
      await vc.save();
      break;

    case "leveling":
      const level = await LevelSettings.findOne({ GuildID: guildId });
      level.XPPerMessage = Number(settings.xpPerMessage || 5);
      level.LevelChannel = settings.levelUpChannelId || null;
      await level.save();
      break;

    case "tickets":
      const ticket = await TicketGuildConfig.findOne({ guildId });
      ticket.panelChannel = settings.panelChannel || null;
      ticket.supportRole = settings.supportRole || null;
      await ticket.save();
      break;

    case "lockdown":
      const lockdown = await LockdownSetup.findOne({ guildId });
      lockdown.channelRoles = (settings.channelRoles || "")
        .split(",")
        .filter(Boolean);
      lockdown.serverRoles = (settings.serverRoles || "")
        .split(",")
        .filter(Boolean);
      await lockdown.save();
      break;

    case "automod":
    case "antiraid":
      const mod = await ModuleSettings.findOne({ guildId, moduleId });
      mod.settings = settings;
      await mod.save();
      break;
  }

  res.json({ ok: true });
};
