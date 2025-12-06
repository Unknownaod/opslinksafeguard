// api/modules/update/[moduleId].js

const connectDB = require("../../../lib/db");

// Core guild config models
const WelcomeGuildConfig = require("../../../models/WelcomeGuildConfig");
const GuildConfig = require("../../../models/GuildConfig");
const AuditGuildConfig = require("../../../models/AuditGuildConfig");
const VcGuildConfig = require("../../../models/VcGuildConfig");
const LockdownSetup = require("../../../models/LockdownSetup");
const BotStatusChannel = require("../../../models/BotStatusChannel");

// Roles / permissions
const AdminRole = require("../../../models/adminRole");
const MuteRole = require("../../../models/muteRole");

// Tickets / panel
const TicketGuildConfig = require("../../../models/TicketGuildConfig");
const Panel = require("../../../models/Panel");

// Leveling / punishments / sticky
const { Settings: LevelSettings } = require("../../../models/LevelSettings");
const PunishmentConfig = require("../../../models/PunishmentConfig");
const Sticky = require("../../../models/Sticky");

// “Generic” module settings (antiraid, automod, announcements, giveaways, polls, sticky extras, etc.)
const ModuleSettings = require("../../../models/ModuleSettings");

// Optional: announcements / giveaways / polls are *per-item* collections;
// for defaults we’ll use ModuleSettings, not these per-event collections.
// const Announcement = require("../../../models/Announcement");
// const Giveaway = require("../../../models/Giveaway");
// const Poll = require("../../../models/Poll");

function toBool(v) {
  if (typeof v === "boolean") return v;
  if (v == null) return false;
  return String(v).trim().toLowerCase() === "true";
}

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function splitIds(str) {
  if (!str) return [];
  return String(str)
    .split(/[,\s\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function getOrCreateWelcome(guildId) {
  let cfg = await WelcomeGuildConfig.findOne({ guildId });
  if (!cfg) {
    cfg = await WelcomeGuildConfig.create({
      guildId,
      welcome: { enabled: false },
      goodbye: { enabled: false },
      autoroles: [],
      autoroleDelay: 0,
      verify: {
        enabled: false,
        roles: [],
        difficulty: { mode: "medium", length: 5, decoys: 10, trace: true },
        kickTimeout: { enabled: false, minutes: 5 },
        pending: {}
      }
    });
  }
  return cfg;
}

async function upsertModuleSettings(guildId, moduleId, settings) {
  return ModuleSettings.findOneAndUpdate(
    { guildId, moduleId },
    {
      $set: {
        guildId,
        moduleId,
        settings: settings || {}
      }
    },
    { upsert: true, new: true }
  );
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();

  const { moduleId } = req.query;
  const { guildId, settings } = req.body || {};

  if (!guildId || !settings || typeof settings !== "object") {
    return res
      .status(400)
      .json({ error: "guildId and settings object are required" });
  }

  try {
    await connectDB();

    switch (moduleId) {
      /* ============================
       *  GENERAL  (WELCOME / VERIFY)
       * ============================ */

      case "welcome": {
        const cfg = await getOrCreateWelcome(guildId);

        // Welcome
        if (settings.welcomeChannelId !== undefined) {
          cfg.welcome.channel = settings.welcomeChannelId || null;
        }
        if (settings.welcomeMessage !== undefined) {
          cfg.welcome.message = settings.welcomeMessage || null;
        }
        if (settings.welcomeDm !== undefined) {
          cfg.welcome.joindm = settings.welcomeDm || null;
        }

        // Goodbye
        if (settings.goodbyeChannelId !== undefined) {
          cfg.goodbye.channel = settings.goodbyeChannelId || null;
        }
        if (settings.goodbyeMessage !== undefined) {
          cfg.goodbye.message = settings.goodbyeMessage || null;
        }
        if (settings.goodbyeDm !== undefined) {
          cfg.goodbye.leavedm = settings.goodbyeDm || null;
        }

        // Autoroles
        if (settings.autoroles !== undefined) {
          cfg.autoroles = splitIds(settings.autoroles);
        }
        if (settings.autoroleDelayMs !== undefined) {
          // you can choose to store as seconds if your bot expects that:
          // cfg.autoroleDelay = Math.floor(toNumber(settings.autoroleDelayMs) / 1000);
          cfg.autoroleDelay = toNumber(settings.autoroleDelayMs); // keep as-is
        }

        cfg.markModified("welcome");
        cfg.markModified("goodbye");
        await cfg.save();

        console.log(`✅ Updated welcome module for guild ${guildId}`);
        return res.json({ ok: true });
      }

      case "verification": {
        const cfg = await getOrCreateWelcome(guildId);
        const v = cfg.verify || (cfg.verify = {});

        if (settings.panelChannelId !== undefined) {
          v.channel = settings.panelChannelId || null;
        }
        if (settings.logChannelId !== undefined) {
          v.logChannel = settings.logChannelId || null;
        }
        if (settings.roles !== undefined) {
          v.roles = splitIds(settings.roles);
        }
        if (settings.staffRoleId !== undefined) {
          v.staffRole = settings.staffRoleId || null;
        }
        if (settings.message !== undefined) {
          v.message = settings.message || "Click Verify to prove you're human.";
        }

        if (!v.difficulty) {
          v.difficulty = { mode: "medium", length: 5, decoys: 10, trace: true };
        }
        if (settings.difficultyMode !== undefined) {
          v.difficulty.mode = String(settings.difficultyMode || "medium");
        }
        if (settings.difficultyLength !== undefined) {
          v.difficulty.length = toNumber(settings.difficultyLength, 5);
        }
        if (settings.difficultyDecoys !== undefined) {
          v.difficulty.decoys = toNumber(settings.difficultyDecoys, 10);
        }
        if (settings.difficultyTrace !== undefined) {
          v.difficulty.trace = toBool(settings.difficultyTrace);
        }

        cfg.verify = v;
        cfg.markModified("verify");
        await cfg.save();

        console.log(`✅ Updated verification module for guild ${guildId}`);
        return res.json({ ok: true });
      }

      /* ============================
       *   LOGGING / CHANNEL CONFIG
       * ============================ */

      case "logging": {
        const channel = settings.modLogChannelId || null;
        await GuildConfig.findOneAndUpdate(
          { guildId },
          { $set: { guildId, modLogChannelId: channel } },
          { upsert: true }
        );
        console.log(`✅ Updated mod logs channel for ${guildId} -> ${channel}`);
        return res.json({ ok: true });
      }

      case "auditlogs": {
        const channel = settings.auditLogChannelId || null;
        await AuditGuildConfig.findOneAndUpdate(
          { guildId },
          { $set: { guildId, modLogChannelId: channel } },
          { upsert: true }
        );
        console.log(
          `✅ Updated audit logs channel for ${guildId} -> ${channel}`
        );
        return res.json({ ok: true });
      }

      case "vclogs": {
        const channel = settings.vcLogChannelId || null;
        await VcGuildConfig.findOneAndUpdate(
          { guildId },
          { $set: { guildId, modLogChannelId: channel } },
          { upsert: true }
        );
        console.log(`✅ Updated VC logs channel for ${guildId} -> ${channel}`);
        return res.json({ ok: true });
      }

      case "adminrole": {
        const roleId = settings.adminRoleId || null;
        await AdminRole.findOneAndUpdate(
          { guildId },
          { $set: { guildId, roleId } },
          { upsert: true }
        );
        console.log(`✅ Updated admin role for ${guildId} -> ${roleId}`);
        return res.json({ ok: true });
      }

      case "muterole": {
        const roleId = settings.muteRoleId || null;
        await MuteRole.findOneAndUpdate(
          { guildId },
          { $set: { guildId, roleId } },
          { upsert: true }
        );
        console.log(`✅ Updated mute role for ${guildId} -> ${roleId}`);
        return res.json({ ok: true });
      }

      case "lockdown": {
        const channelRoles = splitIds(settings.channelRoles);
        const serverRoles = splitIds(settings.serverRoles);

        await LockdownSetup.findOneAndUpdate(
          { guildId },
          {
            $set: {
              guildId,
              channelRoles,
              serverRoles
            }
          },
          { upsert: true }
        );
        console.log(
          `✅ Updated lockdown setup for ${guildId} -> channels=${channelRoles.length}, serverRoles=${serverRoles.length}`
        );
        return res.json({ ok: true });
      }

      case "botstatus": {
        const channelId = settings.statusChannelId || null;

        await BotStatusChannel.findOneAndUpdate(
          { guildId },
          {
            $set: {
              guildId,
              channelId,
              // When changing channel, you might want to reset messageId
              ...(channelId ? {} : { messageId: null })
            }
          },
          { upsert: true }
        );
        console.log(
          `✅ Updated bot status channel for ${guildId} -> ${channelId}`
        );
        return res.json({ ok: true });
      }

      /* ============================
       *        PROTECTION
       * ============================ */

      case "antiraid": {
        const data = {
          joinThreshold: toNumber(settings.joinThreshold, 8),
          timeWindowSec: toNumber(settings.timeWindowSec, 30),
          autoLockdown: toBool(settings.autoLockdown)
        };
        await upsertModuleSettings(guildId, "antiraid", data);
        console.log(`✅ Updated AntiRaid for ${guildId}`, data);
        return res.json({ ok: true });
      }

      case "automod": {
        const data = {
          blockLinks: toBool(settings.blockLinks),
          blockInvites: toBool(settings.blockInvites),
          blacklistedWords: settings.blacklistedWords
            ? String(settings.blacklistedWords)
                .split(/\r?\n/)
                .map((w) => w.trim())
                .filter(Boolean)
            : []
        };
        await upsertModuleSettings(guildId, "automod", data);
        console.log(`✅ Updated AutoMod for ${guildId}`, data);
        return res.json({ ok: true });
      }

      case "punishments": {
        const raw = settings.rules || "";
        const rules = [];

        for (const line of String(raw).split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const [warnStr, actionRaw, durationRaw] = trimmed.split(":");
          const warningCount = toNumber(warnStr, 0);
          const action = (actionRaw || "").trim().toLowerCase(); // timeout / kick / ban
          const duration = durationRaw ? toNumber(durationRaw, null) : null;

          if (!warningCount || !action) continue;
          rules.push({ warningCount, action, duration });
        }

        await PunishmentConfig.findOneAndUpdate(
          { guildId },
          { $set: { guildId, rules } },
          { upsert: true }
        );
        console.log(`✅ Updated punishments for ${guildId}`, rules);
        return res.json({ ok: true });
      }

      /* ============================
       *        ENGAGEMENT
       * ============================ */

      case "leveling": {
        const xp = toNumber(settings.xpPerMessage, 5);
        const levelChannel = settings.levelUpChannelId || null;

        const roles = [];
        if (settings.roleRewards) {
          for (const line of String(settings.roleRewards).split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const [lvlStr, roleId] = trimmed.split(":");
            const lvlNum = toNumber(lvlStr, 0);
            const rId = (roleId || "").trim();
            if (!lvlNum || !rId) continue;
            roles.push({ Level: lvlNum, RoleID: rId });
          }
        }

        await LevelSettings.findOneAndUpdate(
          { GuildID: guildId },
          {
            $set: {
              GuildID: guildId,
              XPPerMessage: xp,
              LevelChannel: levelChannel,
              Roles: roles
            }
          },
          { upsert: true }
        );

        console.log(`✅ Updated leveling for ${guildId}`);
        return res.json({ ok: true });
      }

      case "sticky": {
        const staffRoles = splitIds(settings.staffRoleIds);

        await Sticky.findOneAndUpdate(
          { guildId },
          {
            $set: {
              guildId,
              roleIds: staffRoles
              // stickies array is managed by your /sticky commands
            }
          },
          { upsert: true }
        );

        // Extra options like defaultIntervalMs can live in ModuleSettings
        if (settings.defaultIntervalMs !== undefined) {
          await upsertModuleSettings(guildId, "sticky", {
            defaultIntervalMs: toNumber(settings.defaultIntervalMs, 60000)
          });
        }

        console.log(`✅ Updated sticky config for ${guildId}`);
        return res.json({ ok: true });
      }

      case "announcements": {
        const data = {
          defaultChannelId: settings.defaultChannelId || null,
          pingRoles: splitIds(settings.pingRoles)
        };
        await upsertModuleSettings(guildId, "announcements", data);
        console.log(`✅ Updated announcements config for ${guildId}`, data);
        return res.json({ ok: true });
      }

      case "giveaways": {
        const data = {
          defaultChannelId: settings.defaultChannelId || null,
          defaultDurationMinutes: toNumber(settings.defaultDurationMinutes, 60),
          defaultWinners: toNumber(settings.defaultWinners, 1)
        };
        await upsertModuleSettings(guildId, "giveaways", data);
        console.log(`✅ Updated giveaways config for ${guildId}`, data);
        return res.json({ ok: true });
      }

      case "polls": {
        const data = {
          defaultChannelId: settings.defaultChannelId || null,
          requireRoleIds: splitIds(settings.requireRoleIds)
        };
        await upsertModuleSettings(guildId, "polls", data);
        console.log(`✅ Updated polls config for ${guildId}`, data);
        return res.json({ ok: true });
      }

      case "tickets": {
        const panelChannel = settings.panelChannel || null;
        const supportRole = settings.supportRole || null;
        const ticketCategory = settings.ticketCategory || null;

        await TicketGuildConfig.findOneAndUpdate(
          { guildId },
          {
            $set: {
              guildId,
              panelChannel,
              supportRole,
              ticketCategory
            }
          },
          { upsert: true }
        );

        // optional: keep Panel in sync (if you always want one main panel)
        await Panel.findOneAndUpdate(
          { guildId },
          {
            $setOnInsert: {
              name: "Safeguard Support",
              ticketDescription: "",
              reasons: [],
              blacklist: [],
              options: {
                claimEnabled: true,
                transcriptToFile: true,
                transcriptToChannel: true
              }
            },
            $set: {
              panelChannel,
              supportRole,
              ticketCategory
            }
          },
          { upsert: true }
        );

        console.log(`✅ Updated ticket config for ${guildId}`);
        return res.json({ ok: true });
      }

      default: {
        console.warn("Unknown moduleId in update route:", moduleId);
        return res.status(404).json({ error: "Unknown moduleId" });
      }
    }
  } catch (err) {
    console.error("POST /api/modules/update error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
};
