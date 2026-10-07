import type { Client } from "discord.js";
import { db } from "./db.js";
import { publishTopicQuestions } from "./services/poll-publisher.js";
import { privateErrorSummary } from "./private-errors.js";

const schedulerIntervalMs = 60_000;

export function startScheduler(client: Client) {
  void runDueTopics(client);
  const now = new Date();
  const millisecondsToNextMinute = schedulerIntervalMs - (now.getSeconds() * 1_000 + now.getMilliseconds());
  return setTimeout(() => {
    void runDueTopics(client);
    setInterval(() => void runDueTopics(client), schedulerIntervalMs);
  }, millisecondsToNextMinute);
}

export async function runDueTopics(client: Client) {
  const now = new Date();
  const topics = await db.topic.findMany({
    where: { enabled: true, generationTime: { not: null }, channelId: { not: null } }
  });

  for (const topic of topics) {
    if (!isTopicDue(topic, now)) continue;

    try {
      const channel = await client.channels.fetch(topic.channelId!);
      if (!channel?.isSendable()) continue;
      await publishTopicQuestions(topic, channel);
      console.log("Scheduled generation completed");
    } catch (error) {
      console.error("Scheduled generation failed:", privateErrorSummary(error));
    }
  }
}

function isTopicDue(topic: { generationTime: string | null; lastGeneratedAt: Date | null; intervalDays: number }, now: Date): boolean {
  if (!topic.generationTime) return false;
  const [hours, minutes] = topic.generationTime.split(":").map(Number);
  const scheduledToday = new Date(now);
  scheduledToday.setHours(hours, minutes, 0, 0);
  if (now < scheduledToday) return false;
  if (!topic.lastGeneratedAt) return true;
  const nextAllowedAt = topic.lastGeneratedAt.getTime() + topic.intervalDays * 86_400_000;
  return now.getTime() >= nextAllowedAt;
}
