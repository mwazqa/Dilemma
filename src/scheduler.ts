import type { Client } from "discord.js";
import { db } from "./db.js";
import { publishTopicQuestions } from "./services/poll-publisher.js";
import { privateErrorSummary } from "./private-errors.js";
import { DailyQuizLimitError, TopicScheduleNotReadyError, isTopicDue, nextTopicRunAt } from "./services/quiz-limits.js";
import { DeadlineQueue, retryDelay } from "./services/deadline-queue.js";
import { scheduleEvents, type TopicSchedule } from "./services/schedule-events.js";
import { guildTimezone } from "./services/timezone.js";
import { getGuildSettings } from "./services/guild-settings.js";

const scheduledWhere = { enabled: true, generationTime: { not: null }, channelId: { not: null } };

export function startScheduler(client: Client) {
  let loading = true;
  const changedDuringLoad = new Set<string>();
  const attempts = new Map<string, number>();
  const schedules = new Map<string, TopicSchedule>();
  const timezones = new Map<string, string>();
  const zonesChangedDuringLoad = new Set<string>();
  const timezoneFor = (guildId: string) => timezones.get(guildId) ?? guildTimezone();
  const queue = new DeadlineQueue(async (id, current) => {
    try {
      if (id === "bootstrap") {
        const topics = await db.topic.findMany({ where: scheduledWhere,
          select: { id: true, guildId: true, enabled: true, channelId: true, generationTime: true, startDate: true, lastGeneratedAt: true, intervalDays: true } });
        const guildIds = [...new Set(topics.map(topic => topic.guildId))];
        if (guildIds.length) {
          const settings = await db.guildSettings.findMany({ where: { guildId: { in: guildIds } }, select: { guildId: true, timezone: true } });
          for (const setting of settings) if (!zonesChangedDuringLoad.has(setting.guildId)) timezones.set(setting.guildId, guildTimezone(setting));
        }
        for (const topic of topics) if (!changedDuringLoad.has(topic.id)) schedule(topic);
        loading = false;
        changedDuringLoad.clear();
        zonesChangedDuringLoad.clear();
      } else {
        const topic = await db.topic.findUnique({ where: { id } });
        if (!current()) return;
        if (!topic || nextTopicRunAt(topic, new Date(), timezoneFor(topic.guildId)) === null) { attempts.delete(id); schedules.delete(id); return; }
        if (!isTopicDue(topic, new Date(), false, timezoneFor(topic.guildId))) { schedule(topic); return; }
        try { await publishDueTopic(client, topic, current); }
        catch (error) {
          if (!current()) return;
          if (!(error instanceof DailyQuizLimitError) && !(error instanceof TopicScheduleNotReadyError)) throw error;
          schedule({ ...topic, lastGeneratedAt: new Date(), intervalDays: topic.startDate ? topic.intervalDays : 1 });
        }
      }
      attempts.delete(id);
    } catch (error) {
      if (!current()) return;
      const attempt = attempts.get(id) ?? 0;
      attempts.set(id, attempt + 1);
      queue.schedule(id, Date.now() + retryDelay(attempt, 300_000));
      console.error("Scheduled generation pending:", privateErrorSummary(error));
    }
  }, error => console.error("Scheduled generation failed:", privateErrorSummary(error)));

  function schedule(topic: TopicSchedule) {
    const at = nextTopicRunAt(topic, new Date(), timezoneFor(topic.guildId));
    if (at === null) { queue.cancel(topic.id); schedules.delete(topic.id); }
    else { schedules.set(topic.id, topic); queue.schedule(topic.id, at); }
  }
  function changed(topic: TopicSchedule) {
    if (loading) changedDuringLoad.add(topic.id);
    if (topic.timezone) {
      if (loading) zonesChangedDuringLoad.add(topic.guildId);
      timezones.set(topic.guildId, topic.timezone);
    }
    attempts.delete(topic.id);
    schedule(topic);
  }
  function removed(id: string) {
    if (loading) changedDuringLoad.add(id);
    attempts.delete(id);
    schedules.delete(id);
    queue.cancel(id);
  }
  function timezoneChanged(guildId: string, timezone: string) {
    if (loading) zonesChangedDuringLoad.add(guildId);
    timezones.set(guildId, timezone);
    for (const topic of schedules.values()) if (topic.guildId === guildId) { attempts.delete(topic.id); schedule(topic); }
  }
  scheduleEvents.on("topicChanged", changed);
  scheduleEvents.on("topicDeleted", removed);
  scheduleEvents.on("guildTimezoneChanged", timezoneChanged);
  queue.schedule("bootstrap", Date.now());
  return () => {
    queue.stop();
    scheduleEvents.off("topicChanged", changed);
    scheduleEvents.off("topicDeleted", removed);
    scheduleEvents.off("guildTimezoneChanged", timezoneChanged);
  };
}

async function publishDueTopic(client: Client, topic: Parameters<typeof publishTopicQuestions>[0], current = () => true) {
  const channel = await client.channels.fetch(topic.channelId!);
  if (!current()) return;
  if (!channel?.isSendable()) throw new Error("Scheduled channel unavailable");
  await publishTopicQuestions(topic, channel, false);
  console.log("Scheduled generation completed");
}

let running = false;
export async function runDueTopics(client: Client) {
  if (running) return;
  running = true;
  try {
    const topics = await db.topic.findMany({ where: scheduledWhere });

    for (const topic of topics) {
      if (!isTopicDue(topic, new Date(), false, guildTimezone(await getGuildSettings(topic.guildId)))) continue;
      try { await publishDueTopic(client, topic); }
      catch (error) {
        if (!(error instanceof DailyQuizLimitError) && !(error instanceof TopicScheduleNotReadyError)) console.error("Scheduled generation failed:", privateErrorSummary(error));
      }
    }
  } finally { running = false; }
}
