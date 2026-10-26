import type { Client } from "discord.js";
import { db } from "../db.js";
import { message, normalizeLanguage } from "../messages.js";
import { privateErrorSummary } from "../private-errors.js";
import { DeadlineQueue } from "./deadline-queue.js";
import { guildTimezone } from "./timezone.js";
import { randomQuizReadyAt } from "./quiz-limits.js";
import { resolveQuizPingRole, QuizPingError } from "./quiz-notifications.js";
import { QuizChannelAccessError } from "./quiz-channels.js";
import { scheduleEvents } from "./schedule-events.js";

export function startRandomNotificationScheduler(client: Client) {
  let loading = true;
  const changedDuringLoad = new Set<string>();
  const queue = new DeadlineQueue(async (guildId, current) => {
    if (guildId === "bootstrap") { await bootstrap(current); return; }
    const settings = await db.guildSettings.findUnique({ where: { guildId } });
    if (!settings?.randomPingRoleId) return;
    const poll = await db.randomPoll.findFirst({ where: { guildId }, orderBy: { createdAt: "desc" },
      select: { id: true, channelId: true, createdAt: true, readyPingSentAt: true } });
    if (!poll || poll.readyPingSentAt) return;
    const readyAt = await randomQuizReadyAt(guildId, new Date(), guildTimezone(settings));
    if (+readyAt > Date.now()) { queue.schedule(guildId, readyAt); return; }
    if (!current()) return;
    const latestSettings = await db.guildSettings.findUnique({ where: { guildId } });
    if (!latestSettings?.randomPingRoleId) return;
    const latestPoll = await db.randomPoll.findFirst({ where: { guildId }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (latestPoll?.id !== poll.id) { await scheduleGuild(guildId); return; }
    const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
    const channel = await client.channels.fetch(poll.channelId).catch(() => null);
    if (!guild || !channel?.isSendable()) { await markNotified(poll.id); return; }
    let roleId: string;
    try { roleId = await resolveQuizPingRole(guild, channel.id, latestSettings.randomPingRoleId); }
    catch (error) {
      if (!(error instanceof QuizPingError) && !(error instanceof QuizChannelAccessError)) throw error;
      await markNotified(poll.id);
      console.warn("Random availability notification skipped: role-or-permission-unavailable");
      return;
    }
    if (!current()) return;
    const currentSettings = await db.guildSettings.findUnique({ where: { guildId } });
    if (currentSettings?.randomPingRoleId !== roleId) { await scheduleGuild(guildId); return; }
    try {
      await channel.send({ content: message(normalizeLanguage(currentSettings.language), "randomReadyPing", { role: `<@&${roleId}>` }),
        allowedMentions: { parse: [], roles: [roleId], users: [], repliedUser: false } });
    } catch (error) {
      if (!isPermanentDiscordAccessError(error)) throw error;
      await markNotified(poll.id);
      console.warn("Random availability notification skipped: channel-permission-unavailable");
      return;
    }
    await markNotified(poll.id);
  }, error => console.error("Random availability notification failed:", privateErrorSummary(error)));

  async function scheduleGuild(guildId: string) {
    if (loading) changedDuringLoad.add(guildId);
    const settings = await db.guildSettings.findUnique({ where: { guildId } });
    if (!settings?.randomPingRoleId) { queue.cancel(guildId); return; }
    const poll = await db.randomPoll.findFirst({ where: { guildId }, orderBy: { createdAt: "desc" },
      select: { id: true, readyPingSentAt: true } });
    if (!poll || poll.readyPingSentAt) { queue.cancel(guildId); return; }
    queue.schedule(guildId, await randomQuizReadyAt(guildId, new Date(), guildTimezone(settings)));
  }

  function changed(guildId: string) {
    void scheduleGuild(guildId).catch(error => console.error("Random availability schedule failed:", privateErrorSummary(error)));
  }

  async function bootstrap(current: () => boolean) {
    const settings = await db.guildSettings.findMany({ where: { randomPingRoleId: { not: null } }, select: { guildId: true } });
    loading = false;
    const changedGuilds = new Set(changedDuringLoad);
    changedDuringLoad.clear();
    for (const item of settings) if (current() && !changedGuilds.has(item.guildId)) await scheduleGuild(item.guildId);
    for (const changedGuild of changedGuilds) if (current()) await scheduleGuild(changedGuild);
  }

  scheduleEvents.on("randomPollPublished", changed);
  scheduleEvents.on("randomCooldownChanged", changed);
  scheduleEvents.on("randomNotificationsChanged", changed);
  scheduleEvents.on("guildTimezoneChanged", changed);
  queue.schedule("bootstrap", Date.now());
  return () => {
    queue.stop();
    scheduleEvents.off("randomPollPublished", changed);
    scheduleEvents.off("randomCooldownChanged", changed);
    scheduleEvents.off("randomNotificationsChanged", changed);
    scheduleEvents.off("guildTimezoneChanged", changed);
  };
}

async function markNotified(id: string) {
  await db.randomPoll.updateMany({ where: { id, readyPingSentAt: null }, data: { readyPingSentAt: new Date() } });
}

function isPermanentDiscordAccessError(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return [50001, 50013, 10003, 10008].includes(Number(error.code));
}
